// Writes behind the transaction screens.
//
// Errors are returned, not thrown (Phase 3a spec §6): a failed save re-renders
// the form with an inline message rather than crashing to Next's error page,
// and a raw Postgres error — which can name the host and user — never reaches
// the browser in production.
//
// Two rules run through every function here.
//
// BOOK SAFETY. A category may only ever be attached to a transaction on an
// account in the same book. `src/lib/categories/match.ts` already enforces this
// for the automatic matcher; this is a second, independent path to the same
// data, so it is checked again rather than assumed. The UI cannot produce a
// violation — every dropdown is pre-filtered — and a violation is invisible
// once written: the books still balance, they are just wrong.
//
// MANUAL IS LOAD-BEARING. Setting a category by hand writes
// `categorySource = MANUAL`, which is what makes `categories:apply` skip the
// row forever after. Without it the next rule change would quietly restore the
// wrong answer over the top of a correction, and nothing would look broken.

import { prisma } from "@/lib/prisma";
import type { Book, Prisma } from "@/generated/prisma/client";
import { cashAccountId } from "@/lib/accounts/cash";
import { dollarsToCents } from "@/lib/money";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** Turn any thrown error into something safe to show. */
function failed(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[transactions] ${context} failed`, error);
  return {
    ok: false,
    error:
      process.env.NODE_ENV === "production"
        ? "Saving failed. Check the server logs."
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

/**
 * Parse a dollar string into positive cents.
 *
 * `dollarsToCents` from lib/money.ts rather than a local `dollars * 100`: the
 * naive version turns $1.005 into 100 cents, because `1.005 * 100` is
 * `100.49999999999999` in binary floating point. Returns null rather than 0
 * for unparseable input, so "abc" is rejected instead of silently booking a
 * zero-dollar transaction.
 */
export function parseAmountToCents(raw: unknown): number | null {
  const text = String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (text === "") return null;
  if (!/^\d*\.?\d*$/.test(text)) return null;

  const dollars = Number.parseFloat(text);
  if (!Number.isFinite(dollars) || dollars < 0) return null;

  return dollarsToCents(dollars);
}

/**
 * Combine an amount and a direction into a signed figure.
 *
 * Expenses are stored negative, and the sign comes from the radio rather than
 * from a minus sign someone may or may not have typed. Zero stays zero — it
 * has no direction, and `-0` would be a needlessly surprising thing to store.
 */
export function signedAmountCents(
  amountCents: number,
  direction: "in" | "out",
): number {
  if (amountCents === 0) return 0;
  return direction === "out" ? -amountCents : amountCents;
}

/**
 * Check a category may be attached to these transactions.
 *
 * Resolves the transactions' accounts and the category in one pass and fails
 * closed on any mismatch. A null categoryId is "clear the category", which is
 * always allowed — removing a category can't put data in the wrong book.
 */
async function assertCategoryFits(
  transactionIds: string[],
  categoryId: string | null,
): Promise<string | null> {
  if (transactionIds.length === 0) return "Nothing was selected.";

  const transactions = await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, account: { select: { book: true, name: true } } },
  });

  if (transactions.length !== new Set(transactionIds).size) {
    return "A transaction in this list no longer exists. Reload and try again.";
  }

  if (categoryId === null) return null;

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { name: true, book: true },
  });
  if (!category) {
    return "That category no longer exists. Reload and try again.";
  }

  // An account with no book yet (freshly discovered, not mapped) can't be
  // categorised at all — there is no book to check against, and guessing is
  // how business spending ends up in the personal ledger.
  const unmapped = transactions.find((t) => t.account.book === null);
  if (unmapped) {
    return `${unmapped.account.name} has not been assigned to a book yet. Run \`npm run accounts:map\` first.`;
  }

  const wrongBook = transactions.find((t) => t.account.book !== category.book);
  if (wrongBook) {
    return `${category.name} is a ${category.book.toLowerCase()} category, but ${
      wrongBook.account.name
    } is a ${wrongBook.account.book!.toLowerCase()} account.`;
  }

  return null;
}

/** Set one transaction's category. */
export async function setCategory(
  transactionId: string,
  categoryId: string | null,
): Promise<MutationResult> {
  return bulkSetCategory([transactionId], categoryId);
}

/**
 * Set many transactions' categories in one write.
 *
 * `updateMany` rather than a loop: this is one decision applied to a selection,
 * so it should be one statement that either lands or doesn't. A partial bulk
 * categorise is the worst outcome — the reader sees "done" and half the rows
 * moved.
 */
export async function bulkSetCategory(
  transactionIds: string[],
  categoryId: string | null,
): Promise<MutationResult> {
  const ids = [...new Set(transactionIds)].filter(Boolean);

  const error = await assertCategoryFits(ids, categoryId);
  if (error) return { ok: false, error };

  try {
    await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: {
        categoryId,
        // Clearing a category clears how it got there too, so the row returns
        // to the review queue in the same state a fresh import would be in.
        categorySource: categoryId ? "MANUAL" : null,
        categorisedAt: categoryId ? new Date() : null,
      },
    });
    return { ok: true };
  } catch (error) {
    return failed("bulkSetCategory", error);
  }
}

/** Set one transaction's notes. Empty text clears them. */
export async function setNotes(
  transactionId: string,
  notes: string,
): Promise<MutationResult> {
  const trimmed = notes.trim();

  try {
    const updated = await prisma.transaction.updateMany({
      where: { id: transactionId },
      data: { notes: trimmed === "" ? null : trimmed },
    });

    if (updated.count === 0) {
      return { ok: false, error: "That transaction no longer exists." };
    }
    return { ok: true };
  } catch (error) {
    return failed("setNotes", error);
  }
}

export type ManualTransactionInput = {
  book: Book;
  date: Date;
  description: string;
  payee: string | null;
  categoryId: string | null;
  /** Already signed: negative for money out. */
  amountCents: number;
  notes: string | null;
};

/**
 * Create a manual transaction — cash the bank never sees.
 *
 * The account is resolved from the book to the seeded Cash account rather than
 * accepted from the form. `Transaction.accountId` is required, and attaching
 * manual entries to a real bank account would corrupt that account's
 * reconciliation: its balance comes from Akahu, and a row we invented would
 * never appear in it.
 */
export async function createManualTransaction(
  input: ManualTransactionInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (input.description.trim() === "") {
    return { ok: false, error: "Give it a description — otherwise the row is unreadable later." };
  }

  const accountId = await cashAccountId(prisma, input.book);
  if (!accountId) {
    return {
      ok: false,
      error:
        "The cash account for this book is missing. Run `npm run accounts:seed-cash`.",
    };
  }

  if (input.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { name: true, book: true },
    });
    if (!category) {
      return { ok: false, error: "That category no longer exists." };
    }
    // Re-filtered here regardless of what the client sent (spec §4c).
    if (category.book !== input.book) {
      return {
        ok: false,
        error: `${category.name} is a ${category.book.toLowerCase()} category and this is a ${input.book.toLowerCase()} entry.`,
      };
    }
  }

  try {
    const created = await prisma.transaction.create({
      data: {
        accountId,
        date: input.date,
        description: input.description.trim(),
        payee: input.payee?.trim() || null,
        amountCents: input.amountCents,
        notes: input.notes?.trim() || null,
        categoryId: input.categoryId,
        source: "MANUAL",
        categorySource: input.categoryId ? "MANUAL" : null,
        categorisedAt: input.categoryId ? new Date() : null,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (error) {
    return failed("createManualTransaction", error);
  }
}

export type ManualTransactionEdit = {
  date: Date;
  description: string;
  payee: string | null;
  /** Already signed. */
  amountCents: number;
  notes: string | null;
};

/**
 * Edit a manual transaction's bank-shaped fields.
 *
 * The `source: "MANUAL"` in the where clause is the guard, not a filter: an
 * AKAHU row is the bank's record of what happened, and editing its date or
 * amount would make the app disagree with the statement while looking
 * authoritative. The UI never offers the form; this refuses it anyway.
 */
export async function updateManualTransaction(
  transactionId: string,
  edit: ManualTransactionEdit,
): Promise<MutationResult> {
  if (edit.description.trim() === "") {
    return { ok: false, error: "Give it a description — otherwise the row is unreadable later." };
  }

  try {
    const updated = await prisma.transaction.updateMany({
      where: { id: transactionId, source: "MANUAL" },
      data: {
        date: edit.date,
        description: edit.description.trim(),
        payee: edit.payee?.trim() || null,
        amountCents: edit.amountCents,
        notes: edit.notes?.trim() || null,
      } satisfies Prisma.TransactionUpdateManyMutationInput,
    });

    if (updated.count === 0) {
      // Deliberately one message for both cases. Distinguishing "doesn't
      // exist" from "is a bank row" is a distinction only a prober cares
      // about, and neither is fixable from this screen.
      return {
        ok: false,
        error: "Only manually entered transactions can be edited.",
      };
    }
    return { ok: true };
  } catch (error) {
    return failed("updateManualTransaction", error);
  }
}

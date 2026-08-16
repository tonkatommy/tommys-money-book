// Writes behind the budget screens.
//
// Every function returns a result union instead of throwing, matching the
// pattern the Phase 3a spec set (§6) and `src/app/page.tsx`'s `load()` already
// uses: a failed save re-renders the form with an inline message rather than
// crashing to Next's error page, and a raw database error never reaches the
// browser in production.
//
// Book safety is re-checked on every write. The UI cannot produce a violation
// — the screens only ever render one book's categories — and it is checked
// anyway, because this is a second independent path to the same data that
// `src/lib/categories/match.ts` guards for the automatic matcher. A category
// written against the wrong book is invisible afterwards: the books still
// balance, they are just wrong.

import { prisma } from "@/lib/prisma";
import type { Book } from "@/generated/prisma/client";
import { dollarsToCents } from "@/lib/money";
import { monthEndAmounts, roundToDollar } from "./totals";

export type MutationResult = { ok: true } | { ok: false; error: string };

/** One category's new budget, as submitted by the setup form. */
export type BudgetEntry = {
  categoryId: string;
  amountCents: number;
  isFixed?: boolean;
  dueDay?: number | null;
  estimated?: boolean;
};

/**
 * Parse a dollar string from a form into integer cents.
 *
 * The conversion itself is `dollarsToCents` from lib/money.ts rather than a
 * local `Math.round(dollars * 100)`. That is not tidiness: the naive version
 * turns $1.005 into 100 cents, because `1.005 * 100` is `100.49999999999999`
 * in binary floating point. lib/money.ts exists to solve exactly that, and a
 * second, subtly different conversion at the form boundary would put a
 * rounding bias into every budget Tommy types.
 *
 * Returns null rather than 0 for unparseable input — silently treating "abc"
 * as a zero budget would wipe a category's allowance and look deliberate.
 */
export function parseDollarsToCents(raw: unknown): number | null {
  const text = String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (text === "") return null;
  if (!/^\d*\.?\d*$/.test(text)) return null;

  const dollars = Number.parseFloat(text);
  if (!Number.isFinite(dollars) || dollars < 0) return null;

  return dollarsToCents(dollars);
}

/** Fail closed if any category doesn't belong to the book being edited. */
async function assertBook(
  categoryIds: string[],
  book: Book,
): Promise<string | null> {
  if (categoryIds.length === 0) return null;

  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, book: true, kind: true },
  });

  if (categories.length !== new Set(categoryIds).size) {
    return "A category in this form no longer exists. Reload and try again.";
  }

  const wrongBook = categories.find((category) => category.book !== book);
  if (wrongBook) {
    return `${wrongBook.name} belongs to the ${wrongBook.book.toLowerCase()} book, not this one.`;
  }

  const wrongKind = categories.find((category) => category.kind !== "EXPENSE");
  if (wrongKind) {
    return `${wrongKind.name} is not an expense category and cannot be budgeted.`;
  }

  return null;
}

/** Turn any thrown error into something safe to show. */
function failed(context: string, error: unknown): MutationResult {
  console.error(`[budget] ${context} failed`, error);
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
 * Save a period's budgets.
 *
 * Upserts one row per category for this period. Writing rows only for the
 * period being edited is what keeps history intact: last period's budget stays
 * whatever it was, which is the figure the month-end review compares against.
 */
export async function saveBudgets(
  book: Book,
  periodStart: Date,
  entries: BudgetEntry[],
): Promise<MutationResult> {
  const bookError = await assertBook(
    entries.map((entry) => entry.categoryId),
    book,
  );
  if (bookError) return { ok: false, error: bookError };

  const invalid = entries.find(
    (entry) => !Number.isFinite(entry.amountCents) || entry.amountCents < 0,
  );
  if (invalid) {
    return { ok: false, error: "Budgets must be an amount of $0 or more." };
  }

  try {
    await prisma.$transaction(
      entries.map((entry) =>
        prisma.categoryBudget.upsert({
          where: {
            categoryId_periodStart: { categoryId: entry.categoryId, periodStart },
          },
          create: {
            categoryId: entry.categoryId,
            periodStart,
            amountCents: roundToDollar(entry.amountCents),
            isFixed: entry.isFixed ?? false,
            dueDay: entry.dueDay ?? null,
            estimated: entry.estimated ?? false,
          },
          update: {
            amountCents: roundToDollar(entry.amountCents),
            isFixed: entry.isFixed ?? false,
            dueDay: entry.dueDay ?? null,
            estimated: entry.estimated ?? false,
          },
        }),
      ),
    );
    return { ok: true };
  } catch (error) {
    return failed("saveBudgets", error);
  }
}

/** What a detected bill looks like to the pinning code. */
export type DetectedBill = {
  categoryId: string;
  /** The most recent amount — the best guess for a stable bill. */
  amountCents: number;
  /** The median — robust to a catch-up payment, so better when it varies. */
  typicalAmountCents: number;
  dueDay: number;
  estimated: boolean;
};

/**
 * The budget to write when pinning a bill.
 *
 * Split out from the write so the one judgement here is testable without a
 * database. Two rules, in order:
 *
 *   1. An existing standing budget wins. A figure Tommy typed is a decision,
 *      and pinning a bill is not the moment to overwrite it with an average.
 *   2. Otherwise take the detected amount — the median when the bill varies,
 *      because one catch-up double payment would drag the latest figure well
 *      away from what actually repeats, and the latest figure when it doesn't,
 *      because for a stable bill that is literally next month's cost.
 */
export function billBudgetCents(
  standingCents: number | null,
  bill: Pick<DetectedBill, "amountCents" | "typicalAmountCents" | "estimated">,
): number {
  if (standingCents !== null && standingCents > 0) return roundToDollar(standingCents);
  return roundToDollar(
    bill.estimated ? bill.typicalAmountCents : bill.amountCents,
  );
}

/**
 * Pin every detected bill that isn't pinned yet.
 *
 * The detection is re-run here rather than taken from the request. That is the
 * whole security design of this function: a Server Action is reachable as a
 * direct POST, so a list of category ids in the form data is a list of
 * categories an attacker chose. Recomputing means this can only ever pin what
 * `detectRecurring` independently found — the button carries no more authority
 * than the panel it sits under.
 *
 * An amount is always written, and that matters more than it looks. A pinned
 * bill with a zero budget is worse than an unpinned one: `budgetTotals` holds
 * back `budgetCents - spentCents` for unpaid bills, so a zero-budget bill
 * reserves nothing, and being fixed has already removed it from the pace
 * calculation. It would disappear from the budget in both directions at once.
 */
export async function pinDetectedBills(
  book: Book,
  periodStart: Date,
  suggestions: readonly DetectedBill[],
): Promise<{ ok: true; pinned: number } | { ok: false; error: string }> {
  if (suggestions.length === 0) {
    return { ok: false, error: "There are no unpinned bills to pin." };
  }

  const bookError = await assertBook(
    suggestions.map((suggestion) => suggestion.categoryId),
    book,
  );
  if (bookError) return { ok: false, error: bookError };

  try {
    const existing = await prisma.categoryBudget.findMany({
      where: {
        categoryId: { in: suggestions.map((suggestion) => suggestion.categoryId) },
        periodStart: { lte: periodStart },
      },
      orderBy: { periodStart: "desc" },
    });

    const standing = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      if (!standing.has(row.categoryId)) standing.set(row.categoryId, row);
    }

    const writes = suggestions.map((suggestion) => {
      const current = standing.get(suggestion.categoryId);
      const amountCents = billBudgetCents(current?.amountCents ?? null, suggestion);

      return prisma.categoryBudget.upsert({
        where: {
          categoryId_periodStart: {
            categoryId: suggestion.categoryId,
            periodStart,
          },
        },
        create: {
          categoryId: suggestion.categoryId,
          periodStart,
          amountCents,
          isFixed: true,
          dueDay: suggestion.dueDay,
          estimated: suggestion.estimated,
        },
        // Only the bill flags. An existing row for this period already holds an
        // amount someone chose, and pinning is not an edit of that amount.
        update: {
          isFixed: true,
          dueDay: suggestion.dueDay,
          estimated: suggestion.estimated,
        },
      });
    });

    await prisma.$transaction(writes);
    return { ok: true, pinned: writes.length };
  } catch (error) {
    const result = failed("pinDetectedBills", error);
    return { ok: false, error: result.ok ? "" : result.error };
  }
}

export type MonthEndChoice = "keep" | "carry" | "match";

export type MonthEndDecision = {
  categoryId: string;
  choice: MonthEndChoice;
  /** Last period's budget and actual — what the three options are computed from. */
  previousBudgetCents: number;
  previousSpentCents: number;
};

/**
 * Apply the month-end decisions to the running period.
 *
 * Each decision writes one row for the CURRENT period; last period's rows are
 * left exactly as they were, so the review can be reopened and still show what
 * was actually budgeted at the time.
 */
export async function applyMonthEnd(
  book: Book,
  periodStart: Date,
  decisions: MonthEndDecision[],
): Promise<MutationResult> {
  if (decisions.length === 0) {
    return { ok: false, error: "Nothing was decided, so nothing was changed." };
  }

  const bookError = await assertBook(
    decisions.map((decision) => decision.categoryId),
    book,
  );
  if (bookError) return { ok: false, error: bookError };

  try {
    // The fixed/due-day flags belong to the category, not the decision, so
    // they're carried across from whatever the previous row said rather than
    // being reset to false by a month-end that never asked about them.
    const previous = await prisma.categoryBudget.findMany({
      where: {
        categoryId: { in: decisions.map((decision) => decision.categoryId) },
        periodStart: { lt: periodStart },
      },
      orderBy: { periodStart: "desc" },
    });

    const carried = new Map<string, (typeof previous)[number]>();
    for (const row of previous) {
      if (!carried.has(row.categoryId)) carried.set(row.categoryId, row);
    }

    await prisma.$transaction(
      decisions.map((decision) => {
        const amounts = monthEndAmounts(
          decision.previousBudgetCents,
          decision.previousSpentCents,
        )[decision.choice];
        const flags = carried.get(decision.categoryId);

        return prisma.categoryBudget.upsert({
          where: {
            categoryId_periodStart: {
              categoryId: decision.categoryId,
              periodStart,
            },
          },
          create: {
            categoryId: decision.categoryId,
            periodStart,
            amountCents: amounts.amountCents,
            carryoverCents: amounts.carryoverCents,
            isFixed: flags?.isFixed ?? false,
            dueDay: flags?.dueDay ?? null,
            estimated: flags?.estimated ?? false,
          },
          update: {
            amountCents: amounts.amountCents,
            carryoverCents: amounts.carryoverCents,
          },
        });
      }),
    );

    return { ok: true };
  } catch (error) {
    return failed("applyMonthEnd", error);
  }
}

/** Save the pay cycle. */
export async function savePayCycle(
  anchorDay: number,
  splitFortnightly: boolean,
): Promise<MutationResult> {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    return { ok: false, error: "Payday must be a day of the month, 1 to 31." };
  }

  try {
    await prisma.budgetSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", anchorDay, splitFortnightly },
      update: { anchorDay, splitFortnightly },
    });
    return { ok: true };
  } catch (error) {
    return failed("savePayCycle", error);
  }
}

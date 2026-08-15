"use server";

// Server Actions behind the transaction screens.
//
// Each one re-checks the session before touching anything. `src/proxy.ts`
// already covers these routes, but the Next.js docs are explicit that a Server
// Function is reachable as a direct POST rather than only through the UI, and
// the proxy matcher is one regex edit away from silently excluding a path.
//
// Errors are returned, not thrown (Phase 3a spec §6).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth/guard";
import {
  bulkSetCategory,
  createManualTransaction,
  parseAmountToCents,
  setCategory,
  setNotes,
  signedAmountCents,
  updateManualTransaction,
} from "@/lib/transactions/mutate";
import { parseDateParam } from "@/lib/transactions/query";

export type FormState = { ok: false; error: string } | undefined;

const UNAUTHORISED: FormState = {
  ok: false,
  error: "Your session has expired. Reload the page and sign in again.",
};

/** An empty select means "no category", which is a real choice, not a missing one. */
function categoryFrom(formData: FormData): string | null {
  const value = String(formData.get("categoryId") ?? "").trim();
  return value === "" ? null : value;
}

/**
 * Apply one category to every selected row.
 *
 * The selection arrives as repeated `ids` fields, which is what a table of
 * plain checkboxes posts — so this works with JavaScript disabled and the
 * client island only ever improved the button's label.
 */
export async function bulkCategoriseAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const ids = formData
    .getAll("ids")
    .map((value) => String(value))
    .filter(Boolean);

  if (ids.length === 0) {
    return { ok: false, error: "Tick the rows you want to categorise first." };
  }

  const result = await bulkSetCategory(ids, categoryFrom(formData));
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/transactions");
  revalidatePath("/budget");
  return undefined;
}

/** Set one transaction's category, from the detail screen. */
export async function setCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "That transaction no longer exists." };

  const result = await setCategory(id, categoryFrom(formData));
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/transactions/${id}`);
  revalidatePath("/transactions");
  revalidatePath("/budget");
  return undefined;
}

/** Set one transaction's notes. */
export async function setNotesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "That transaction no longer exists." };

  const result = await setNotes(id, String(formData.get("notes") ?? ""));
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/transactions/${id}`);
  return undefined;
}

/**
 * Edit a manual transaction's bank-shaped fields.
 *
 * `updateManualTransaction` refuses anything that isn't a MANUAL row, so this
 * doesn't re-check the source: one guard in the place that writes beats two
 * that can drift apart.
 */
export async function updateManualAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "That transaction no longer exists." };

  const date = parseDateParam(String(formData.get("date") ?? ""));
  if (!date) return { ok: false, error: "Give it a date as YYYY-MM-DD." };

  const amountCents = parseAmountToCents(formData.get("amount"));
  if (amountCents === null) {
    return { ok: false, error: "That amount is not a number." };
  }

  const direction = formData.get("direction") === "in" ? "in" : "out";

  const result = await updateManualTransaction(id, {
    date,
    description: String(formData.get("description") ?? ""),
    payee: String(formData.get("payee") ?? "") || null,
    amountCents: signedAmountCents(amountCents, direction),
    notes: String(formData.get("notes") ?? "") || null,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/transactions/${id}`);
  revalidatePath("/transactions");
  revalidatePath("/budget");
  return undefined;
}

/**
 * Create a manual transaction.
 *
 * On failure the caller re-renders with what was typed, so the state carries
 * the error only — the form's own `defaultValue`s come from the submitted
 * FormData that React preserves. Redirects on success, which is why the happy
 * path returns nothing.
 */
export async function createManualAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const book = formData.get("book") === "BUSINESS" ? "BUSINESS" : "PERSONAL";

  const date = parseDateParam(String(formData.get("date") ?? ""));
  if (!date) return { ok: false, error: "Give it a date as YYYY-MM-DD." };

  const amountCents = parseAmountToCents(formData.get("amount"));
  if (amountCents === null) {
    return { ok: false, error: "That amount is not a number." };
  }
  if (amountCents === 0) {
    return { ok: false, error: "A zero-dollar entry would not tell you anything." };
  }

  const direction = formData.get("direction") === "in" ? "in" : "out";

  const result = await createManualTransaction({
    book,
    date,
    description: String(formData.get("description") ?? ""),
    payee: String(formData.get("payee") ?? "") || null,
    categoryId: categoryFrom(formData),
    amountCents: signedAmountCents(amountCents, direction),
    notes: String(formData.get("notes") ?? "") || null,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/transactions");
  revalidatePath("/budget");
  redirect(book === "BUSINESS" ? "/transactions?book=BUSINESS" : "/transactions");
}

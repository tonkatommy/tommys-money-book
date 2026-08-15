"use server";

// Server Actions behind the budget forms.
//
// Each one re-checks the session before touching anything. `src/proxy.ts`
// already covers these routes, but the Next.js docs are explicit that a
// Server Function is reachable as a direct POST rather than only through the
// UI, and the proxy matcher is one regex edit away from silently excluding a
// path. See src/lib/auth/guard.ts.
//
// Errors are returned, not thrown (Phase 3a spec §6): the form re-renders with
// an inline message instead of crashing to Next's error page.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth/guard";
import { parseBook } from "@/lib/budget/query";
import {
  applyMonthEnd,
  parseDollarsToCents,
  saveBudgets,
  savePayCycle,
  type BudgetEntry,
  type MonthEndChoice,
  type MonthEndDecision,
  type MutationResult,
} from "@/lib/budget/mutate";

export type FormState = { ok: false; error: string } | undefined;

const UNAUTHORISED: FormState = {
  ok: false,
  error: "Your session has expired. Reload the page and sign in again.",
};

/** A period start from a hidden field, back to the UTC-midnight Date we store. */
function parsePeriodStart(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Save the budget form.
 *
 * One submit for the whole screen. Each category posts three fields —
 * `amount:<id>`, and optionally `fixed:<id>` and `due:<id>` — which is what
 * lets the form work with no JavaScript at all.
 */
export async function saveBudgetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const book = parseBook(String(formData.get("book") ?? ""));
  const periodStart = parsePeriodStart(formData.get("periodStart"));
  if (!periodStart) {
    return { ok: false, error: "That period is not a date. Reload and try again." };
  }

  const entries: BudgetEntry[] = [];
  const rejected: string[] = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("amount:")) continue;
    const categoryId = key.slice("amount:".length);

    const amountCents = parseDollarsToCents(raw);
    if (amountCents === null) {
      rejected.push(categoryId);
      continue;
    }

    const isFixed = formData.get(`fixed:${categoryId}`) === "on";
    const dueRaw = Number.parseInt(String(formData.get(`due:${categoryId}`) ?? ""), 10);

    entries.push({
      categoryId,
      amountCents,
      isFixed,
      // A due day only means something for a bill, and only 1–31 is a day.
      dueDay:
        isFixed && Number.isInteger(dueRaw) && dueRaw >= 1 && dueRaw <= 31
          ? dueRaw
          : null,
      estimated: formData.get(`estimated:${categoryId}`) === "on",
    });
  }

  if (rejected.length > 0) {
    return {
      ok: false,
      error: `${rejected.length} amount${
        rejected.length === 1 ? " is" : "s are"
      } not a number. Nothing was saved — fix them and try again.`,
    };
  }

  if (entries.length === 0) {
    return { ok: false, error: "There was nothing to save." };
  }

  const result = await saveBudgets(book, periodStart, entries);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/budget");
  redirect(book === "BUSINESS" ? "/budget?book=BUSINESS" : "/budget");
}

/** Save the pay cycle. Separate form, separate submit — it changes every period. */
export async function savePayCycleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const anchorDay = Number.parseInt(String(formData.get("anchorDay") ?? ""), 10);
  const splitFortnightly = formData.get("splitFortnightly") === "on";

  const result: MutationResult = await savePayCycle(anchorDay, splitFortnightly);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/budget");
  revalidatePath("/budget/setup");
  return undefined;
}

/**
 * Apply the month-end decisions.
 *
 * Last period's budget and actual are posted alongside each choice so the
 * three options are computed from exactly the figures the reader was looking
 * at — re-querying here could produce different amounts if a late transaction
 * landed between render and submit.
 */
export async function applyMonthEndAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const book = parseBook(String(formData.get("book") ?? ""));
  const periodStart = parsePeriodStart(formData.get("periodStart"));
  if (!periodStart) {
    return { ok: false, error: "That period is not a date. Reload and try again." };
  }

  const decisions: MonthEndDecision[] = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("choice:")) continue;

    const choice = String(raw) as MonthEndChoice;
    if (choice !== "keep" && choice !== "carry" && choice !== "match") continue;

    const categoryId = key.slice("choice:".length);
    const previousBudgetCents = Number.parseInt(
      String(formData.get(`budget:${categoryId}`) ?? ""),
      10,
    );
    const previousSpentCents = Number.parseInt(
      String(formData.get(`spent:${categoryId}`) ?? ""),
      10,
    );

    if (!Number.isFinite(previousBudgetCents) || !Number.isFinite(previousSpentCents)) {
      continue;
    }

    decisions.push({
      categoryId,
      choice,
      previousBudgetCents,
      previousSpentCents,
    });
  }

  if (decisions.length === 0) {
    return {
      ok: false,
      error: "Nothing was decided yet — pick an option for at least one category.",
    };
  }

  const result = await applyMonthEnd(book, periodStart, decisions);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/budget");
  revalidatePath("/budget/review");
  redirect(book === "BUSINESS" ? "/budget?book=BUSINESS" : "/budget");
}

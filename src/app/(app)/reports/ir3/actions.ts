"use server";

// The Server Action behind the IR3 adjustments form.
//
// Re-checks the session before touching anything, matching every other
// action in the app (invariant 6, src/app/(app)/budget/actions.ts).
// Errors are returned, not thrown, so a rejected submit re-renders the form
// with an inline message rather than crashing to Next's error page.

import { revalidatePath } from "next/cache";
import { hasSession } from "@/lib/auth/guard";
import { parseDollarsToCents } from "@/lib/budget/mutate";
import { saveTaxYearAdjustment } from "@/lib/reports/mutate";

export type FormState = { ok: false; error: string } | undefined;

const UNAUTHORISED: FormState = {
  ok: false,
  error: "Your session has expired. Reload the page and sign in again.",
};

/**
 * A dollar field that may legitimately be blank.
 *
 * `parseDollarsToCents` returns `null` for both "" and "abc" — budgets have
 * no use for that distinction because every category needs a real amount,
 * but this form does: blank means "not entered yet" (stored as SQL NULL,
 * which is what makes `computeRentalFigures` warn instead of assuming a
 * figure), while "abc" is a typo that must not silently become NULL either.
 */
function parseOptionalDollars(
  raw: FormDataEntryValue | null,
): { ok: true; cents: number | null } | { ok: false } {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, cents: null };

  const cents = parseDollarsToCents(text);
  return cents === null ? { ok: false } : { ok: true, cents };
}

export async function saveTaxYearAdjustmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const fyLabel = String(formData.get("fyLabel") ?? "");
  if (!/^FY\d{4}$/.test(fyLabel)) {
    return { ok: false, error: "That financial year is not valid. Reload and try again." };
  }

  const managementFee = parseOptionalDollars(formData.get("rentalManagementFee"));
  const mortgageInterest = parseOptionalDollars(formData.get("rentalMortgageInterest"));

  if (!managementFee.ok || !mortgageInterest.ok) {
    return {
      ok: false,
      error: "Both figures must be a dollar amount or left blank. Nothing was saved.",
    };
  }

  const result = await saveTaxYearAdjustment(fyLabel, {
    rentalManagementFeeCents: managementFee.cents,
    rentalMortgageInterestCents: mortgageInterest.cents,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/reports/ir3");
  return undefined;
}

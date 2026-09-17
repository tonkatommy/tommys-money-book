// Writes behind the reports screens.
//
// The only write in this section is the IR3 adjustments form — the two
// figures the Akahu feed cannot see (Phase 4a spec §2). Everything else
// under `src/lib/reports/` is a read. Same result-union pattern as
// `src/lib/budget/mutate.ts`: a failed save re-renders the form with an
// inline message instead of crashing to Next's error page.

import { prisma } from "@/lib/prisma";
import { parseDollarsToCents } from "@/lib/budget/mutate";

export type MutationResult = { ok: true } | { ok: false; error: string };

/**
 * A dollar field that may legitimately be blank, for the adjustments form.
 *
 * `parseDollarsToCents` returns `null` for both "" and "abc" — budgets have
 * no use for that distinction because every category needs a real amount,
 * but this form does: blank means "not entered yet" (stored as SQL NULL,
 * which is what makes `computeRentalFigures`, reports/ir3.ts, warn instead
 * of assuming a figure), while "abc" is a typo that must not silently
 * become NULL too. Exported from this plain module rather than defined
 * inside the "use server" actions file so it's unit-testable without a
 * request context — the same reason `parseDollarsToCents` itself lives in
 * `src/lib/budget/mutate.ts` rather than `budget/actions.ts`.
 */
export function parseOptionalDollars(
  raw: FormDataEntryValue | null | undefined,
): { ok: true; cents: number | null } | { ok: false } {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, cents: null };

  const cents = parseDollarsToCents(text);
  return cents === null ? { ok: false } : { ok: true, cents };
}

/** Turn any thrown error into something safe to show. Matches budget/mutate.ts. */
function failed(context: string, error: unknown): MutationResult {
  console.error(`[reports] ${context} failed`, error);
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
 * Save the two manual figures for one financial year.
 *
 * `null` is a valid value for either field — it means "not entered", and is
 * what makes `computeRentalFigures` (`reports/ir3.ts`) warn instead of
 * silently treating the figure as zero. There is no book-safety check here,
 * unlike every other write in the app: `TaxYearAdjustment` has no book and
 * nothing about it can cross one.
 */
export async function saveTaxYearAdjustment(
  fyLabel: string,
  values: {
    rentalManagementFeeCents: number | null;
    rentalMortgageInterestCents: number | null;
  },
): Promise<MutationResult> {
  for (const [field, cents] of Object.entries(values)) {
    if (cents !== null && (!Number.isFinite(cents) || cents < 0)) {
      return { ok: false, error: `${field} must be zero or more, or blank.` };
    }
  }

  try {
    await prisma.taxYearAdjustment.upsert({
      where: { fyLabel },
      create: { fyLabel, ...values },
      update: values,
    });
    return { ok: true };
  } catch (error) {
    return failed("saveTaxYearAdjustment", error);
  }
}

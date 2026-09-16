// The IR3 pack's arithmetic — pure, no Prisma.
//
// Every function here takes already-fetched `CategoryTotal[]` (from
// `reports/query.ts`) rather than a `PrismaClient`, so every branch,
// including the missing-adjustment and missing-category paths, is reachable
// from a unit test with no database — the same split `reports/fy.ts` and
// `budget/totals.ts` already use.
//
// The two things this file exists to get right are named in the Phase 4a
// spec (§2): the Ray White management fee (rent arrives net; the IR3 needs
// gross income with the fee as its own deductible line) and the ASB mortgage
// interest/principal split (the bank feed carries one repayment total, and
// only interest is deductible). Both figures come from an annual statement,
// not a transaction, so both are supplied by the caller as a
// `TaxYearAdjustment` rather than derived from `categories`. When either is
// missing, the number that depends on it must say so rather than quietly
// using the bank-fed total as if it were the true figure — assuming the
// whole mortgage repayment is interest would overstate a deduction, which is
// the wrong direction to be wrong in on a document going to IRD.

import type { CategoryTotal } from "./query";

/** IRD's home office apportionment rate for the 2026/27 year. */
export const HOME_OFFICE_RATE = 0.1257;

// Categories the IR3 math has to recognise individually, not just by tax
// tag — seven categories carry RENTAL_EXPENSE and only one of them needs its
// principal stripped out. This is the same kind of coupling
// `rollingBusinessTurnoverCents` already has with its doubled
// `taxTag`+`book` guard in `categories/verify.ts`, and `definitions.ts`'s
// own comments on these categories anticipated exactly this: the category
// list is code, and this is one more piece of code reading it by name.
export const RENTAL_INCOME_CATEGORY_NAME = "Rental Income — Cashel St";
export const RENTAL_MORTGAGE_CATEGORY_NAME = "Rental — Mortgage Payments";
export const RENTAL_MANAGEMENT_FEE_CATEGORY_NAME = "Rental — Management Fees";
const ENTERTAINMENT_CATEGORY_NAME = "Entertainment";
const AIA_CATEGORY_NAME = "Income Protection Claims";

/**
 * The 12.57% deduction on an already-integer cents total.
 *
 * Worth stating plainly: this is a derived report figure computed from an
 * already-integer total, not a value parsed from decimal human input or
 * written back as a transaction amount, so it is not the case
 * `dollarsToCents` (src/lib/money.ts) exists to guard against. A second,
 * uncontrolled money *parse* at a form boundary would be a bug; a percentage
 * applied once to a cents integer and rounded is not.
 */
export function homeOfficeDeductionCents(eligibleCents: number): number {
  return Math.round(eligibleCents * HOME_OFFICE_RATE);
}

/** The two figures the Akahu feed cannot see, as read from `TaxYearAdjustment`. */
export type RentalAdjustment = {
  rentalManagementFeeCents: number | null;
  rentalMortgageInterestCents: number | null;
};

export type RentalExpenseLine = {
  name: string;
  /** Positive cents. */
  totalCents: number;
  /** The one line whose bank-fed total includes non-deductible principal. */
  isMortgage: boolean;
  /** True for the management-fee line, which comes from the adjustment, not a transaction. */
  fromAdjustment: boolean;
};

export type RentalFigures = {
  netRentReceivedCents: number;
  /** 0 when the adjustment has not been entered for this FY. */
  managementFeeCents: number;
  /** Net rent received + the management fee, grossed up for the IR3. */
  grossIncomeCents: number;
  expenseLines: RentalExpenseLine[];
  /** The bank-fed total for the mortgage category — principal AND interest. */
  mortgagePaymentsCents: number;
  /** From the adjustment. Null means "not entered" — the mortgage line is then excluded from `deductibleExpenseCents` entirely. */
  mortgageInterestCents: number | null;
  /** `mortgagePaymentsCents - mortgageInterestCents`, or 0 when interest isn't known. */
  mortgagePrincipalCents: number;
  /** Every RENTAL_EXPENSE line except the non-deductible mortgage principal. */
  deductibleExpenseCents: number;
  netCents: number;
  warnings: string[];
};

/**
 * The Cashel St rental summary for one financial year.
 *
 * `categories` is expected to be `categoryTotals(PERSONAL, fy.start,
 * rangeEnd)` — it only contains categories with at least one transaction in
 * range, so `Rental — Management Fees` (no baseline transactions, by design
 * per `definitions.ts`) will not be in it. The management-fee expense line
 * is synthesised from the adjustment instead, which is also how the
 * gross-up income addition works: the fee never appears as a transaction at
 * all, so both sides of it are computed here rather than read from a row.
 */
export function computeRentalFigures(
  categories: CategoryTotal[],
  adjustment: RentalAdjustment,
): RentalFigures {
  const warnings: string[] = [];

  const netRentReceivedCents =
    categories.find(
      (category) =>
        category.name === RENTAL_INCOME_CATEGORY_NAME &&
        category.taxTag === "RENTAL_INCOME",
    )?.totalCents ?? 0;

  const managementFeeCents = adjustment.rentalManagementFeeCents ?? 0;
  if (adjustment.rentalManagementFeeCents === null) {
    warnings.push(
      "The Ray White management fee has not been entered for this financial " +
        "year. Gross rental income and the management fee deduction are both " +
        "understated by the same amount — net income is unaffected, but the " +
        "IR3 needs the gross figure, not the net one.",
    );
  }

  const grossIncomeCents = netRentReceivedCents + managementFeeCents;

  const rentalExpenseCategories = categories.filter(
    (category) => category.taxTag === "RENTAL_EXPENSE",
  );
  const mortgageCategory = rentalExpenseCategories.find(
    (category) => category.name === RENTAL_MORTGAGE_CATEGORY_NAME,
  );
  const mortgagePaymentsCents = mortgageCategory?.totalCents ?? 0;

  // `categories` only contains rows with at least one transaction in range,
  // so a missing category here is indistinguishable from a genuinely quiet
  // FY — but it's also indistinguishable from the category having been
  // renamed out from under this hardcoded name, which would otherwise
  // silently read as a true zero. Say so either way, informationally.
  if (!mortgageCategory) {
    warnings.push(
      `No transactions were found in "${RENTAL_MORTGAGE_CATEGORY_NAME}" for ` +
        `this financial year.`,
    );
  }

  const mortgageInterestCents = adjustment.rentalMortgageInterestCents;
  if (mortgagePaymentsCents > 0 && mortgageInterestCents === null) {
    warnings.push(
      `The mortgage interest for this financial year has not been entered ` +
        `from the ASB loan statement. "${RENTAL_MORTGAGE_CATEGORY_NAME}" is ` +
        `excluded from the deductible total entirely until it is — assuming ` +
        `the whole repayment is interest would overstate the deduction.`,
    );
  }

  const mortgagePrincipalCents =
    mortgageInterestCents !== null
      ? Math.max(0, mortgagePaymentsCents - mortgageInterestCents)
      : 0;

  const expenseLines: RentalExpenseLine[] = rentalExpenseCategories.map(
    (category) => ({
      name: category.name,
      totalCents: category.totalCents,
      isMortgage: category.name === RENTAL_MORTGAGE_CATEGORY_NAME,
      fromAdjustment: false,
    }),
  );

  if (managementFeeCents > 0) {
    expenseLines.push({
      name: RENTAL_MANAGEMENT_FEE_CATEGORY_NAME,
      totalCents: managementFeeCents,
      isMortgage: false,
      fromAdjustment: true,
    });
  }

  // Every deductible line except the mortgage, plus only the interest
  // portion of the mortgage (0 when it isn't known yet) — never the full
  // bank-fed repayment, which would silently include the principal.
  const nonMortgageExpenseCents = expenseLines
    .filter((line) => !line.isMortgage)
    .reduce((total, line) => total + line.totalCents, 0);
  const deductibleExpenseCents =
    nonMortgageExpenseCents + (mortgageInterestCents ?? 0);

  return {
    netRentReceivedCents,
    managementFeeCents,
    grossIncomeCents,
    expenseLines,
    mortgagePaymentsCents,
    mortgageInterestCents,
    mortgagePrincipalCents,
    deductibleExpenseCents,
    netCents: grossIncomeCents - deductibleExpenseCents,
    warnings,
  };
}

export type BusinessExpenseLine = {
  name: string;
  totalCents: number;
  isEntertainment: boolean;
};

export type BusinessFigures = {
  incomeLines: { name: string; totalCents: number }[];
  incomeCents: number;
  expenseLines: BusinessExpenseLine[];
  /** Every BIZ_EXPENSE line at full value, entertainment included. */
  expensesCents: number;
  entertainmentCents: number;
  netCents: number;
  caveats: string[];
};

/** The Tommy Tinkers summary for one financial year. */
export function computeBusinessFigures(
  categories: CategoryTotal[],
): BusinessFigures {
  const incomeLines = categories
    .filter((category) => category.taxTag === "BIZ_INCOME")
    .map((category) => ({ name: category.name, totalCents: category.totalCents }));

  const expenseLines: BusinessExpenseLine[] = categories
    .filter((category) => category.taxTag === "BIZ_EXPENSE")
    .map((category) => ({
      name: category.name,
      totalCents: category.totalCents,
      isEntertainment: category.name === ENTERTAINMENT_CATEGORY_NAME,
    }));

  const incomeCents = incomeLines.reduce((total, line) => total + line.totalCents, 0);
  const expensesCents = expenseLines.reduce((total, line) => total + line.totalCents, 0);
  const entertainmentCents =
    expenseLines.find((line) => line.isEntertainment)?.totalCents ?? 0;

  const caveats: string[] = [];
  if (entertainmentCents > 0) {
    // Never auto-halved — that is a decision for Garreth, not a default this
    // code picks. See definitions.ts's own note on this category.
    caveats.push(
      "Entertainment is shown here at full value. NZ commonly limits " +
        "entertainment deductions to 50% — confirm the treatment with " +
        "Garreth before filing.",
    );
  }

  return {
    incomeLines,
    incomeCents,
    expenseLines,
    expensesCents,
    entertainmentCents,
    netCents: incomeCents - expensesCents,
    caveats,
  };
}

export type HomeOfficeFigures = {
  lines: { name: string; totalCents: number }[];
  eligibleCents: number;
  deductionCents: number;
};

/**
 * The home office deduction for one financial year.
 *
 * Sums the four HOME_OFFICE-tagged categories, which live in the PERSONAL
 * book even though the deduction is claimed against the business —
 * `definitions.ts` says so directly, and this function is what makes that
 * true: it reads by tag, not by book. `categories` should therefore be
 * `categoryTotals(PERSONAL, ...)`, the same read `computeRentalFigures`
 * uses, not a business-book read.
 */
export function computeHomeOfficeFigures(
  categories: CategoryTotal[],
): HomeOfficeFigures {
  const lines = categories
    .filter((category) => category.taxTag === "HOME_OFFICE")
    .map((category) => ({ name: category.name, totalCents: category.totalCents }));

  const eligibleCents = lines.reduce((total, line) => total + line.totalCents, 0);

  return { lines, eligibleCents, deductionCents: homeOfficeDeductionCents(eligibleCents) };
}

export type TaxableIncomeFigures = {
  lines: { name: string; totalCents: number }[];
  totalCents: number;
  caveats: string[];
};

/** Salary, benefit, and AIA income protection — the personal income the IR3 needs beyond rental. */
export function computeTaxableIncomeFigures(
  categories: CategoryTotal[],
): TaxableIncomeFigures {
  const lines = categories
    .filter((category) => category.taxTag === "TAXABLE_INCOME")
    .map((category) => ({ name: category.name, totalCents: category.totalCents }));

  const totalCents = lines.reduce((total, line) => total + line.totalCents, 0);

  const caveats: string[] = [];
  const aia = lines.find((line) => line.name === AIA_CATEGORY_NAME);
  if (aia && aia.totalCents > 0) {
    // Carried over from definitions.ts's own note: taxable per Tommy, but a
    // lump-sum trauma/TPD payment would not be, and that distinction is
    // Garreth's to confirm, not this code's to assume.
    caveats.push(
      "Income Protection Claims (AIA) is treated as taxable income " +
        "protection. Confirm with Garreth before filing — a lump-sum trauma " +
        "or TPD payment would not be taxable.",
    );
  }

  return { lines, totalCents, caveats };
}

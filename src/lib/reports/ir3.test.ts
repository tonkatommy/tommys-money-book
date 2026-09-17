// The IR3 pack's arithmetic: the gross-up, the mortgage principal/interest
// split, the 12.57% home office rate, and every case where a missing figure
// must produce a warning rather than a plausible wrong number.

import { describe, expect, it } from "vitest";
import {
  computeBusinessFigures,
  computeHomeOfficeFigures,
  computeRentalFigures,
  computeTaxableIncomeFigures,
  HOME_OFFICE_RATE_FY_LABEL,
  homeOfficeDeductionCents,
  RENTAL_MANAGEMENT_FEE_CATEGORY_NAME,
  RENTAL_MORTGAGE_CATEGORY_NAME,
} from "./ir3";
import type { CategoryTotal } from "./query";

const category = (
  name: string,
  taxTag: CategoryTotal["taxTag"],
  totalCents: number,
  kind: CategoryTotal["kind"] = "EXPENSE",
): CategoryTotal => ({
  categoryId: name,
  name,
  kind,
  taxTag,
  totalCents,
  transactions: 1,
});

describe("homeOfficeDeductionCents", () => {
  it("applies 12.57% and rounds to the nearest cent", () => {
    // $1,000.00 * 12.57% = $125.70 exactly.
    expect(homeOfficeDeductionCents(100_000)).toBe(12_570);
  });

  it("rounds a total that does not divide evenly", () => {
    // $1.00 * 12.57% = 12.57 cents, which rounds up to 13.
    expect(homeOfficeDeductionCents(100)).toBe(13);
  });

  it("is zero for a zero total", () => {
    expect(homeOfficeDeductionCents(0)).toBe(0);
  });
});

describe("computeRentalFigures", () => {
  const categories: CategoryTotal[] = [
    category("Rental Income — Cashel St", "RENTAL_INCOME", 24_000_00, "INCOME"),
    category(RENTAL_MORTGAGE_CATEGORY_NAME, "RENTAL_EXPENSE", 18_000_00),
    category("Rental — Rates", "RENTAL_EXPENSE", 2_400_00),
    category("Rental — Insurance", "RENTAL_EXPENSE", 1_200_00),
  ];

  it("grosses up income and adds the management fee as its own deductible line when the adjustment is entered", () => {
    const figures = computeRentalFigures(categories, {
      rentalManagementFeeCents: 1_800_00,
      rentalMortgageInterestCents: 15_000_00,
    });

    expect(figures.netRentReceivedCents).toBe(24_000_00);
    expect(figures.managementFeeCents).toBe(1_800_00);
    expect(figures.managementFeeEntered).toBe(true);
    expect(figures.grossIncomeCents).toBe(25_800_00);

    const feeLine = figures.expenseLines.find(
      (line) => line.name === RENTAL_MANAGEMENT_FEE_CATEGORY_NAME,
    );
    expect(feeLine?.totalCents).toBe(1_800_00);
    expect(feeLine?.fromAdjustment).toBe(true);

    // Mortgage principal is excluded: only the $15,000 interest counts,
    // not the full $18,000 repayment.
    expect(figures.mortgagePrincipalCents).toBe(3_000_00);
    expect(figures.deductibleExpenseCents).toBe(
      2_400_00 + 1_200_00 + 1_800_00 + 15_000_00,
    );
    expect(figures.warnings).toHaveLength(0);
  });

  it("warns and excludes the mortgage line entirely when interest has not been entered", () => {
    const figures = computeRentalFigures(categories, {
      rentalManagementFeeCents: null,
      rentalMortgageInterestCents: null,
    });

    // Gross-up warning and mortgage-interest warning both fire.
    expect(figures.warnings).toHaveLength(2);
    expect(figures.warnings.join(" ")).toMatch(/management fee/i);
    expect(figures.warnings.join(" ")).toMatch(/mortgage interest/i);

    expect(figures.managementFeeCents).toBe(0);
    expect(figures.managementFeeEntered).toBe(false);
    expect(figures.grossIncomeCents).toBe(figures.netRentReceivedCents);

    // Deductible total is every non-mortgage expense only — the mortgage
    // repayment is not assumed to be fully deductible.
    expect(figures.deductibleExpenseCents).toBe(2_400_00 + 1_200_00);
    expect(figures.mortgagePrincipalCents).toBe(0);
  });

  it("warns instead of treating a missing mortgage category as a true zero", () => {
    const withoutMortgage = categories.filter(
      (c) => c.name !== RENTAL_MORTGAGE_CATEGORY_NAME,
    );

    const figures = computeRentalFigures(withoutMortgage, {
      rentalManagementFeeCents: 1_800_00,
      rentalMortgageInterestCents: null,
    });

    expect(figures.mortgagePaymentsCents).toBe(0);
    expect(
      figures.warnings.some((warning) =>
        warning.includes(RENTAL_MORTGAGE_CATEGORY_NAME),
      ),
    ).toBe(true);
    // No mortgage payments this range, so nothing is silently excluded from
    // the deductible total by the missing-interest branch.
    expect(figures.deductibleExpenseCents).toBe(2_400_00 + 1_200_00 + 1_800_00);
  });

  it("still warns about missing interest when reversals net the mortgage category to zero", () => {
    // A failed direct debit and its reversal both landed this FY — real
    // mortgage activity happened, but the net total is zero, not positive.
    const withNettedMortgage = categories.map((c) =>
      c.name === RENTAL_MORTGAGE_CATEGORY_NAME ? { ...c, totalCents: 0 } : c,
    );

    const figures = computeRentalFigures(withNettedMortgage, {
      rentalManagementFeeCents: 1_800_00,
      rentalMortgageInterestCents: null,
    });

    expect(figures.mortgagePaymentsCents).toBe(0);
    expect(figures.warnings.some((warning) => /mortgage interest/i.test(warning))).toBe(
      true,
    );
  });

  it("does not warn that the management fee is missing when it was genuinely entered as $0", () => {
    const figures = computeRentalFigures(categories, {
      rentalManagementFeeCents: 0,
      rentalMortgageInterestCents: 15_000_00,
    });

    expect(figures.managementFeeEntered).toBe(true);
    expect(figures.warnings.some((warning) => /management fee/i.test(warning))).toBe(
      false,
    );
  });

  it("caps a mistyped interest figure at what was actually paid, and warns", () => {
    // $20,000 entered against only $18,000 of mortgage payments this FY.
    const figures = computeRentalFigures(categories, {
      rentalManagementFeeCents: 1_800_00,
      rentalMortgageInterestCents: 20_000_00,
    });

    // The raw entered figure is preserved for display...
    expect(figures.mortgageInterestCents).toBe(20_000_00);
    // ...but never used for the deduction, which cannot exceed what was paid.
    expect(figures.mortgageInterestUsedCents).toBe(18_000_00);
    expect(figures.mortgagePrincipalCents).toBe(0);
    expect(figures.deductibleExpenseCents).toBe(2_400_00 + 1_200_00 + 1_800_00 + 18_000_00);
    expect(figures.warnings.some((warning) => /more than the total paid/i.test(warning))).toBe(
      true,
    );
  });

  it("does not cap or warn when the entered interest is within what was paid", () => {
    const figures = computeRentalFigures(categories, {
      rentalManagementFeeCents: 1_800_00,
      rentalMortgageInterestCents: 18_000_00,
    });

    expect(figures.mortgageInterestUsedCents).toBe(18_000_00);
    expect(figures.mortgagePrincipalCents).toBe(0);
    expect(figures.warnings.some((warning) => /more than the total paid/i.test(warning))).toBe(
      false,
    );
  });

  it("warns instead of treating a missing rental income category as zero rent", () => {
    const withoutIncome = categories.filter(
      (c) => c.name !== "Rental Income — Cashel St",
    );

    const figures = computeRentalFigures(withoutIncome, {
      rentalManagementFeeCents: 1_800_00,
      rentalMortgageInterestCents: 15_000_00,
    });

    expect(figures.netRentReceivedCents).toBe(0);
    // Gross income is only the management fee — a small, plausible-looking
    // number that would otherwise carry no sign anything is wrong.
    expect(figures.grossIncomeCents).toBe(1_800_00);
    expect(
      figures.warnings.some((warning) => warning.includes("Rental Income — Cashel St")),
    ).toBe(true);
  });
});

describe("computeBusinessFigures", () => {
  it("separates Entertainment without halving it, and flags the caveat", () => {
    const categories: CategoryTotal[] = [
      category("Sales — Shopify", "BIZ_INCOME", 5_000_00, "INCOME"),
      category("Materials & Supplies", "BIZ_EXPENSE", 800_00),
      category("Entertainment", "BIZ_EXPENSE", 120_00),
    ];

    const figures = computeBusinessFigures(categories);

    expect(figures.incomeCents).toBe(5_000_00);
    expect(figures.entertainmentCents).toBe(120_00);
    // Full value, not halved.
    expect(figures.expensesCents).toBe(800_00 + 120_00);
    expect(figures.netCents).toBe(5_000_00 - 920_00);
    expect(figures.caveats.join(" ")).toMatch(/50%/);
  });

  it("has no entertainment caveat when there is nothing in the category", () => {
    const categories: CategoryTotal[] = [
      category("Sales — Shopify", "BIZ_INCOME", 5_000_00, "INCOME"),
      category("Materials & Supplies", "BIZ_EXPENSE", 800_00),
    ];

    expect(computeBusinessFigures(categories).caveats).toHaveLength(0);
  });
});

describe("computeHomeOfficeFigures", () => {
  const categories: CategoryTotal[] = [
    category("Home Rent", "HOME_OFFICE", 20_000_00),
    category("Home Power", "HOME_OFFICE", 2_000_00),
    category("Groceries", null, 1_000_00), // untagged, must not be counted
  ];

  it("sums the HOME_OFFICE categories and applies the rate", () => {
    const figures = computeHomeOfficeFigures(categories, HOME_OFFICE_RATE_FY_LABEL);

    expect(figures.eligibleCents).toBe(22_000_00);
    expect(figures.deductionCents).toBe(homeOfficeDeductionCents(22_000_00));
    expect(figures.lines).toHaveLength(2);
    expect(figures.rateUnconfirmed).toBe(false);
    expect(figures.caveats).toHaveLength(0);
  });

  it("flags the rate as unconfirmed for any other financial year", () => {
    const figures = computeHomeOfficeFigures(categories, "FY2026");

    expect(figures.rateUnconfirmed).toBe(true);
    expect(figures.caveats.join(" ")).toMatch(/FY2026/);
    // Still computes a figure — the caveat is informational, not a refusal.
    expect(figures.deductionCents).toBe(homeOfficeDeductionCents(22_000_00));
  });
});

describe("computeTaxableIncomeFigures", () => {
  it("flags the AIA caveat only when there is AIA income", () => {
    const withAia: CategoryTotal[] = [
      category("Salary & Wages", "TAXABLE_INCOME", 10_000_00, "INCOME"),
      category("Income Protection Claims", "TAXABLE_INCOME", 4_755_00, "INCOME"),
    ];

    const figures = computeTaxableIncomeFigures(withAia);
    expect(figures.totalCents).toBe(14_755_00);
    expect(figures.caveats.join(" ")).toMatch(/AIA/);

    const withoutAia: CategoryTotal[] = [
      category("Salary & Wages", "TAXABLE_INCOME", 10_000_00, "INCOME"),
    ];
    expect(computeTaxableIncomeFigures(withoutAia).caveats).toHaveLength(0);
  });
});

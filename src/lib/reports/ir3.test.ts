// The IR3 pack's arithmetic: the gross-up, the mortgage principal/interest
// split, the 12.57% home office rate, and every case where a missing figure
// must produce a warning rather than a plausible wrong number.

import { describe, expect, it } from "vitest";
import {
  computeBusinessFigures,
  computeHomeOfficeFigures,
  computeRentalFigures,
  computeTaxableIncomeFigures,
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
  it("sums the HOME_OFFICE categories and applies the rate", () => {
    const categories: CategoryTotal[] = [
      category("Home Rent", "HOME_OFFICE", 20_000_00),
      category("Home Power", "HOME_OFFICE", 2_000_00),
      category("Groceries", null, 1_000_00), // untagged, must not be counted
    ];

    const figures = computeHomeOfficeFigures(categories);

    expect(figures.eligibleCents).toBe(22_000_00);
    expect(figures.deductionCents).toBe(homeOfficeDeductionCents(22_000_00));
    expect(figures.lines).toHaveLength(2);
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

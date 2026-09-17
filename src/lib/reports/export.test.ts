// The workbook the export route hands to Garreth. `buildIr3Workbook` takes
// a plain `Ir3Pack` — no Prisma — so its money-bearing branches (blank vs.
// confirmed adjustments, capped interest, completeness warnings) are
// unit-tested the same as the arithmetic that produces the pack, rather
// than only checked by hand against the screen.

import { describe, expect, it } from "vitest";
import type { Worksheet } from "exceljs";
import {
  computeBusinessFigures,
  computeHomeOfficeFigures,
  computeRentalFigures,
  computeTaxableIncomeFigures,
} from "./ir3";
import { buildIr3Workbook } from "./export";
import { fyBounds } from "./fy";
import type { CategoryTotal, DataQuality, Ir3Pack } from "./query";

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

const noQualityIssues: DataQuality = { uncategorisedCount: 0, unassignedAccountCount: 0 };

const rentalCategories: CategoryTotal[] = [
  category("Rental Income — Cashel St", "RENTAL_INCOME", 24_000_00, "INCOME"),
  category("Rental — Mortgage Payments", "RENTAL_EXPENSE", 18_000_00),
  category("Rental — Rates", "RENTAL_EXPENSE", 2_400_00),
];

const businessCategories: CategoryTotal[] = [
  category("Sales — Shopify", "BIZ_INCOME", 5_000_00, "INCOME"),
  category("Materials & Supplies", "BIZ_EXPENSE", 800_00),
];

/** A complete pack for one scenario, so each test only varies what it's checking. */
function buildPack(overrides?: {
  adjustment?: { rentalManagementFeeCents: number | null; rentalMortgageInterestCents: number | null };
  quality?: DataQuality;
  fyLabel?: string;
}): Ir3Pack {
  const fy = overrides?.fyLabel
    ? { ...fyBounds(2027), label: overrides.fyLabel }
    : fyBounds(2027);
  const adjustment = overrides?.adjustment ?? {
    rentalManagementFeeCents: 1_800_00,
    rentalMortgageInterestCents: 15_000_00,
  };
  const quality = overrides?.quality ?? noQualityIssues;

  return {
    fy,
    rangeEnd: fy.end,
    rangeLabel: fy.range,
    adjustment,
    rental: computeRentalFigures(rentalCategories, adjustment),
    business: computeBusinessFigures(businessCategories),
    homeOffice: computeHomeOfficeFigures([], fy.label),
    taxableIncome: computeTaxableIncomeFigures([]),
    personalQuality: quality,
    businessQuality: quality,
  };
}

function textOf(sheet: Worksheet | undefined): string {
  const lines: string[] = [];
  sheet?.eachRow((row) => {
    lines.push(row.values ? Array.from(row.values as unknown[]).join(" | ") : "");
  });
  return lines.join("\n");
}

describe("buildIr3Workbook", () => {
  it("carries no completeness warning on the Overview sheet when the data is clean", () => {
    const workbook = buildIr3Workbook(buildPack());
    expect(textOf(workbook.getWorksheet("Overview"))).not.toMatch(/may be incomplete/i);
  });

  it("surfaces uncategorised and unmapped counts on the Overview sheet", () => {
    const workbook = buildIr3Workbook(
      buildPack({ quality: { uncategorisedCount: 3, unassignedAccountCount: 1 } }),
    );
    const overview = textOf(workbook.getWorksheet("Overview"));

    expect(overview).toMatch(/may be incomplete/i);
    expect(overview).toMatch(/3 personal transaction/);
    expect(overview).toMatch(/1 account\(s\) are not assigned/);
  });

  it("marks the management fee as not entered only when it's genuinely blank", () => {
    const blank = buildIr3Workbook(
      buildPack({
        adjustment: { rentalManagementFeeCents: null, rentalMortgageInterestCents: 15_000_00 },
      }),
    );
    expect(textOf(blank.getWorksheet("Rental — Cashel St"))).toMatch(/not entered for this year/);

    // A confirmed $0 must not read the same as "not entered" — the exact
    // distinction managementFeeEntered exists to preserve.
    const confirmedZero = buildIr3Workbook(
      buildPack({
        adjustment: { rentalManagementFeeCents: 0, rentalMortgageInterestCents: 15_000_00 },
      }),
    );
    expect(textOf(confirmedZero.getWorksheet("Rental — Cashel St"))).not.toMatch(
      /not entered for this year/,
    );
  });

  it("shows the mortgage interest actually used and the principal, not the raw entered figure", () => {
    // $20,000 entered against only $18,000 paid — capped at what was paid.
    const workbook = buildIr3Workbook(
      buildPack({
        adjustment: { rentalManagementFeeCents: 1_800_00, rentalMortgageInterestCents: 20_000_00 },
      }),
    );
    const rentalSheet = textOf(workbook.getWorksheet("Rental — Cashel St"));

    expect(rentalSheet).toMatch(/interest only/);
    expect(rentalSheet).toMatch(/more than the total paid/);
  });

  it("flags the home office rate as unconfirmed for any FY other than the verified one", () => {
    const workbook = buildIr3Workbook(buildPack({ fyLabel: "FY2026" }));
    expect(textOf(workbook.getWorksheet("Home office"))).toMatch(/FY2026/);
  });

  it("has no rate caveat for the verified financial year", () => {
    const workbook = buildIr3Workbook(buildPack({ fyLabel: "FY2027" }));
    expect(textOf(workbook.getWorksheet("Home office"))).not.toMatch(/confirm the correct rate/);
  });
});

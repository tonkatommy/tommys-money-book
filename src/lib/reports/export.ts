// The IR3 pack as a workbook.
//
// Lays the exact figures already on `/reports/ir3` into `exceljs` sheets,
// one per return section, so the file Garreth opens and the screen Tommy
// read from say the same thing — no second computation, just formatting.
// `centsToDollars` is the only conversion here; nothing recomputes a total.

import ExcelJS from "exceljs";
import { centsToDollars } from "@/lib/money";
import type { Ir3Pack } from "./query";

const CURRENCY_FORMAT = "$#,##0.00";

function addTitle(sheet: ExcelJS.Worksheet, title: string, rangeLabel: string) {
  sheet.mergeCells("A1:C1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = `${title} — ${rangeLabel}`;
  titleCell.font = { bold: true, size: 13 };

  sheet.getColumn(1).width = 40;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 40;
  sheet.addRow([]);
}

function addLine(
  sheet: ExcelJS.Worksheet,
  label: string,
  cents: number,
  note?: string,
) {
  const row = sheet.addRow([label, centsToDollars(cents), note ?? ""]);
  row.getCell(2).numFmt = CURRENCY_FORMAT;
}

function addTotalLine(sheet: ExcelJS.Worksheet, label: string, cents: number) {
  const row = sheet.addRow([label, centsToDollars(cents)]);
  row.font = { bold: true };
  row.getCell(2).numFmt = CURRENCY_FORMAT;
}

function addCaveats(sheet: ExcelJS.Worksheet, caveats: string[]) {
  if (caveats.length === 0) return;
  sheet.addRow([]);
  for (const caveat of caveats) {
    const row = sheet.addRow([`Note: ${caveat}`]);
    row.font = { italic: true, color: { argb: "FF808080" } };
    sheet.mergeCells(`A${row.number}:C${row.number}`);
    row.getCell(1).alignment = { wrapText: true };
  }
}

/**
 * A leading "Overview" sheet, so the completeness warnings the screen shows
 * (`QualityAlerts`, reports/parts.tsx) aren't lost on the way to a workbook.
 *
 * Every figure in this pack filters on `category.kind`, so an uncategorised
 * transaction is silently absent from every total — the totals still add up,
 * and nothing in the rest of the workbook looks wrong. Without this sheet, a
 * workbook forwarded to Garreth would look complete even when it's known to
 * be missing data; exceljs opens a workbook to its first sheet, which is why
 * this one is added first rather than appended at the end.
 */
function addOverviewSheet(workbook: ExcelJS.Workbook, pack: Ir3Pack): void {
  const sheet = workbook.addWorksheet("Overview");
  addTitle(sheet, "IR3 pack", pack.rangeLabel);

  const { personalQuality, businessQuality } = pack;
  const warnings: string[] = [];
  if (personalQuality.uncategorisedCount > 0) {
    warnings.push(
      `${personalQuality.uncategorisedCount} personal transaction(s) in this ` +
        `range have no category and are missing from every rental and ` +
        `other-income figure in this pack.`,
    );
  }
  if (businessQuality.uncategorisedCount > 0) {
    warnings.push(
      `${businessQuality.uncategorisedCount} business transaction(s) in this ` +
        `range have no category and are missing from the Tommy Tinkers figures.`,
    );
  }
  if (personalQuality.unassignedAccountCount > 0) {
    warnings.push(
      `${personalQuality.unassignedAccountCount} account(s) are not assigned ` +
        `to a set of books, so their transactions appear nowhere in this pack.`,
    );
  }

  if (warnings.length > 0) {
    const header = sheet.addRow(["These figures may be incomplete"]);
    header.font = { bold: true, color: { argb: "FFCC3333" } };
    for (const warning of warnings) {
      const row = sheet.addRow([warning]);
      row.font = { color: { argb: "FFCC3333" } };
      sheet.mergeCells(`A${row.number}:C${row.number}`);
      row.getCell(1).alignment = { wrapText: true };
    }
    sheet.addRow([]);
  }

  sheet.addRow([
    "This is a starting point for the return, not a filed one. See each " +
      "section's own notes for figures still needing Garreth's confirmation.",
  ]).font = { italic: true };
}

/**
 * Build the workbook. Pure given a pack — no Prisma, no request handling —
 * so the route handler stays a thin wrapper around this and `getIr3Pack`.
 */
export function buildIr3Workbook(pack: Ir3Pack): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tommy's Money Book";
  workbook.created = new Date();

  const { rental, business, homeOffice, taxableIncome } = pack;

  addOverviewSheet(workbook, pack);

  const rentalSheet = workbook.addWorksheet("Rental — Cashel St");
  addTitle(rentalSheet, "Rental — Cashel St", pack.rangeLabel);
  addLine(rentalSheet, "Net rent received", rental.netRentReceivedCents);
  addLine(
    rentalSheet,
    "Management fee (gross-up)",
    rental.managementFeeCents,
    rental.managementFeeEntered ? undefined : "not entered for this year",
  );
  addTotalLine(rentalSheet, "Gross rental income", rental.grossIncomeCents);
  rentalSheet.addRow([]);
  rentalSheet.addRow(["Expenses"]).font = { bold: true };
  for (const line of rental.expenseLines) {
    if (line.isMortgage) {
      addLine(
        rentalSheet,
        `${line.name} — interest only`,
        rental.mortgageInterestCents ?? 0,
        rental.mortgageInterestCents === null
          ? `excluded — of ${centsToDollars(rental.mortgagePaymentsCents).toFixed(2)} paid, interest not entered`
          : `${centsToDollars(rental.mortgagePrincipalCents).toFixed(2)} principal (not deductible) of ${centsToDollars(rental.mortgagePaymentsCents).toFixed(2)} paid`,
      );
    } else {
      addLine(rentalSheet, line.name, line.totalCents, line.fromAdjustment ? "from adjustment" : undefined);
    }
  }
  addTotalLine(rentalSheet, "Deductible expenses", rental.deductibleExpenseCents);
  rentalSheet.addRow([]);
  addTotalLine(rentalSheet, "Net rental result", rental.netCents);
  addCaveats(rentalSheet, rental.warnings);

  const businessSheet = workbook.addWorksheet("Tommy Tinkers");
  addTitle(businessSheet, "Tommy Tinkers", pack.rangeLabel);
  businessSheet.addRow(["Income"]).font = { bold: true };
  for (const line of business.incomeLines) {
    addLine(businessSheet, line.name, line.totalCents);
  }
  addTotalLine(businessSheet, "Total income", business.incomeCents);
  businessSheet.addRow([]);
  businessSheet.addRow(["Expenses"]).font = { bold: true };
  for (const line of business.expenseLines) {
    addLine(
      businessSheet,
      line.name,
      line.totalCents,
      line.isEntertainment ? "50% limit not applied — confirm" : undefined,
    );
  }
  addTotalLine(businessSheet, "Total expenses", business.expensesCents);
  businessSheet.addRow([]);
  addTotalLine(businessSheet, "Net business result", business.netCents);
  addCaveats(businessSheet, business.caveats);

  const homeOfficeSheet = workbook.addWorksheet("Home office");
  addTitle(homeOfficeSheet, "Home office", pack.rangeLabel);
  for (const line of homeOffice.lines) {
    addLine(homeOfficeSheet, line.name, line.totalCents);
  }
  addTotalLine(homeOfficeSheet, "Eligible costs", homeOffice.eligibleCents);
  homeOfficeSheet.addRow([]);
  addTotalLine(homeOfficeSheet, "Deduction at 12.57%", homeOffice.deductionCents);
  addCaveats(homeOfficeSheet, homeOffice.caveats);

  const taxableIncomeSheet = workbook.addWorksheet("Other taxable income");
  addTitle(taxableIncomeSheet, "Other taxable income", pack.rangeLabel);
  for (const line of taxableIncome.lines) {
    addLine(taxableIncomeSheet, line.name, line.totalCents);
  }
  addTotalLine(taxableIncomeSheet, "Total", taxableIncome.totalCents);
  addCaveats(taxableIncomeSheet, taxableIncome.caveats);

  return workbook;
}

// The monthly bucketing, which is the only new arithmetic in the reports layer.
//
// Everything else in `query.ts` is a Prisma read and is verified by hand
// against the dev server (Phase 3a spec §7). `bucketByMonth` is pure, so it is
// tested here: rows in, twelve buckets out.
//
// The cases below are the ways a monthly breakdown lies without complaining —
// a month silently missing from the table, a sign flipped twice, a February
// that has not happened yet reported as a February with no spending, and a row
// landing one bucket out because the FY does not start in January.

import { describe, expect, it } from "vitest";
import { utcDate } from "@/lib/budget/period";
import { fyBounds } from "./fy";
import { bucketByMonth, type MonthlyRow } from "./query";

const fy = fyBounds(2027); // 01/04/2026 – 31/03/2027
const closed = fy.end;

const income = (date: Date, cents: number): MonthlyRow => ({
  date,
  amountCents: cents,
  kind: "INCOME",
});

// Expenses arrive from the database negative. The flip to positive happens
// once, inside the bucketing — see invariant 2.
const expense = (date: Date, storedCents: number): MonthlyRow => ({
  date,
  amountCents: storedCents,
  kind: "EXPENSE",
});

describe("bucketByMonth", () => {
  it("always returns twelve buckets, April first", () => {
    const months = bucketByMonth(fy, [], closed);

    expect(months).toHaveLength(12);
    expect(months[0].label).toBe("Apr 2026");
    expect(months[0].start).toEqual(utcDate(2026, 3, 1));
    expect(months[11].label).toBe("Mar 2027");
    expect(months[11].end).toEqual(utcDate(2027, 2, 31));
  });

  it("prints each bucket's literal range, per spec §2", () => {
    const months = bucketByMonth(fy, [], closed);

    expect(months[0].range).toBe("01/04/2026 – 30/04/2026");
    // February 2027 is not a leap year; the last day comes from the calendar,
    // not from a table someone has to keep right.
    expect(months[10].range).toBe("01/02/2027 – 28/02/2027");
  });

  it("keeps a month with no transactions as a zero row rather than dropping it", () => {
    const months = bucketByMonth(fy, [income(utcDate(2026, 3, 15), 5000)], closed);

    expect(months).toHaveLength(12);

    const may = months[1];
    expect(may.label).toBe("May 2026");
    expect(may.transactions).toBe(0);
    expect(may.incomeCents).toBe(0);
    expect(may.expensesCents).toBe(0);
    expect(may.netCents).toBe(0);
    // A closed FY has no future months, so this really is "nothing happened"
    // rather than "nothing has happened yet".
    expect(may.future).toBe(false);
  });

  it("buckets by calendar month, not by offset from the FY start", () => {
    const months = bucketByMonth(
      fy,
      [
        income(utcDate(2026, 3, 1), 100), // 01/04/2026 — first day of the FY
        income(utcDate(2026, 11, 25), 200), // 25/12/2026 — across a year boundary
        income(utcDate(2027, 2, 31), 300), // 31/03/2027 — last day of the FY
      ],
      closed,
    );

    expect(months[0].incomeCents).toBe(100);
    expect(months[8].label).toBe("Dec 2026");
    expect(months[8].incomeCents).toBe(200);
    expect(months[11].incomeCents).toBe(300);
  });

  it("flips expenses to positive exactly once and nets income against them", () => {
    const months = bucketByMonth(
      fy,
      [income(utcDate(2026, 4, 20), 400_000), expense(utcDate(2026, 4, 3), -150_00)],
      closed,
    );

    const may = months[1];
    expect(may.incomeCents).toBe(400_000);
    expect(may.expensesCents).toBe(150_00);
    expect(may.netCents).toBe(400_000 - 150_00);
    expect(may.transactions).toBe(2);
  });

  it("lets a refund push a month's expenses negative rather than clamping", () => {
    // A $200 refund against $50 of spending in the same month. Clamping to
    // zero would hide a real correction and make the year's totals disagree
    // with the sum of its months.
    const months = bucketByMonth(
      fy,
      [expense(utcDate(2026, 5, 8), -50_00), expense(utcDate(2026, 5, 9), 200_00)],
      closed,
    );

    expect(months[2].expensesCents).toBe(-150_00);
  });

  it("marks months after the range end as future, not as zero spending", () => {
    // Standing on 24/08/2026, five months into FY2027.
    const months = bucketByMonth(fy, [], utcDate(2026, 7, 24));

    expect(months[3].label).toBe("Jul 2026");
    expect(months[3].future).toBe(false);
    expect(months[3].partial).toBe(false);

    // August contains the range end, so its figures are still moving.
    expect(months[4].label).toBe("Aug 2026");
    expect(months[4].future).toBe(false);
    expect(months[4].partial).toBe(true);

    expect(months[5].label).toBe("Sep 2026");
    expect(months[5].future).toBe(true);
  });

  it("treats a closed financial year as having no future or partial months", () => {
    const months = bucketByMonth(fy, [], closed);

    expect(months.some((month) => month.future)).toBe(false);
    expect(months.some((month) => month.partial)).toBe(false);
  });

  it("drops rows outside the financial year instead of folding them into an end bucket", () => {
    const months = bucketByMonth(
      fy,
      [
        income(utcDate(2026, 2, 31), 999), // 31/03/2026 — the FY before
        income(utcDate(2027, 3, 1), 999), // 01/04/2027 — the FY after
        income(utcDate(2026, 6, 1), 100),
      ],
      closed,
    );

    expect(months.reduce((sum, month) => sum + month.incomeCents, 0)).toBe(100);
    expect(months.reduce((sum, month) => sum + month.transactions, 0)).toBe(1);
  });
});

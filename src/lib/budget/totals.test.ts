import { describe, expect, it } from "vitest";
import { payPeriodFor, utcDate } from "./period";
import {
  allowanceCents,
  budgetTotals,
  monthEndAmounts,
  type BudgetLine,
} from "./totals";

const ANCHOR = 20;

/** Day 27 of 31 — the state the design prototype was drawn against. */
const period = payPeriodFor(utcDate(2026, 7, 15), ANCHOR);

function line(over: Partial<BudgetLine> = {}): BudgetLine {
  return {
    categoryId: "c1",
    name: "Groceries",
    budgetCents: 72_000,
    spentCents: 61_140,
    isFixed: false,
    paid: false,
    ...over,
  };
}

describe("budgetTotals", () => {
  it("paces flexible spending against how far through the period we are", () => {
    const totals = budgetTotals([line()], 100_000, period);

    // 27/31 of $720 is $627.10; $611.40 spent leaves us just under pace.
    expect(totals.expectedCents).toBe(62_710);
    expect(totals.paceDeltaCents).toBe(62_710 - 61_140);
  });

  it("holds fixed bills out of the pace maths", () => {
    const totals = budgetTotals(
      [
        line(),
        line({ categoryId: "c2", name: "Rent", budgetCents: 104_000, spentCents: 104_000, isFixed: true, paid: true }),
      ],
      100_000,
      period,
    );

    // The rent is in the overall budget but not in the flexible pace figures —
    // pacing a rent payment evenly across a month is a meaningless number.
    expect(totals.budgetCents).toBe(72_000 + 104_000);
    expect(totals.flexBudgetCents).toBe(72_000);
    expect(totals.expectedCents).toBe(62_710);
  });

  it("subtracts unpaid bills and untouched budgets from safe to spend", () => {
    const totals = budgetTotals(
      [
        line({ budgetCents: 72_000, spentCents: 61_140 }),
        line({ categoryId: "c2", name: "Power", budgetCents: 16_500, spentCents: 0, isFixed: true, paid: false }),
      ],
      168_405,
      period,
    );

    // $1,684.05 in the bank, less the $165 power bill still to land, less the
    // $108.60 of grocery budget not yet spent.
    expect(totals.fixedRemainingCents).toBe(16_500);
    expect(totals.untouchedCents).toBe(10_860);
    expect(totals.safeCents).toBe(168_405 - 16_500 - 10_860);
  });

  it("ignores a paid bill when working out what is still owed", () => {
    const totals = budgetTotals(
      [line({ categoryId: "c2", budgetCents: 16_500, spentCents: 16_500, isFixed: true, paid: true })],
      100_000,
      period,
    );

    expect(totals.fixedRemainingCents).toBe(0);
  });

  it("does not let one category's overspend free up another's budget", () => {
    // The point of flooring per category: blowing the takeaways budget does
    // not make the grocery money available, because that money is still
    // committed to groceries.
    const totals = budgetTotals(
      [
        line({ categoryId: "a", budgetCents: 20_000, spentCents: 0 }),
        line({ categoryId: "b", budgetCents: 10_000, spentCents: 25_000 }),
      ],
      100_000,
      period,
    );

    expect(totals.untouchedCents).toBe(20_000);
  });

  it("projects the run rate to the end of the period", () => {
    const totals = budgetTotals([line()], 100_000, period);

    // $611.40 over 27 days, carried across all 31.
    expect(totals.projectedCents).toBe(Math.round((61_140 / 27) * 31));
    expect(totals.projectedDeltaCents).toBe(72_000 - totals.projectedCents);
  });

  it("does not project from a single day's spending", () => {
    // On day 1 a $200 shop would project to $6,200 for the month. "At this
    // rate" is not yet a rate, so the projection falls back to the budget.
    const dayOne = payPeriodFor(utcDate(2026, 7, 20), ANCHOR);
    const totals = budgetTotals([line({ spentCents: 20_000 })], 100_000, dayOne);

    expect(dayOne.dayOfPeriod).toBe(1);
    expect(totals.projectedCents).toBe(72_000);
  });

  it("survives a zero budget", () => {
    const totals = budgetTotals(
      [line({ budgetCents: 0, spentCents: 4_300 })],
      100_000,
      period,
    );

    expect(Number.isFinite(totals.expectedCents)).toBe(true);
    expect(Number.isFinite(totals.projectedCents)).toBe(true);
    expect(totals.expectedCents).toBe(0);
  });

  it("does not divide by zero on the last day of the period", () => {
    const lastDay = payPeriodFor(utcDate(2026, 7, 19), ANCHOR);
    const totals = budgetTotals([line()], 50_000, lastDay);

    expect(lastDay.daysLeft).toBe(0);
    expect(Number.isFinite(totals.perDayCents)).toBe(true);
    expect(totals.perDayCents).toBe(totals.safeCents);
  });

  it("reports a negative safe-to-spend rather than clamping it", () => {
    // Being genuinely short is the single most important thing this screen
    // can say. Flooring it at zero would hide exactly that.
    const totals = budgetTotals(
      [line({ categoryId: "c2", budgetCents: 200_000, spentCents: 0, isFixed: true, paid: false })],
      50_000,
      period,
    );

    expect(totals.safeCents).toBeLessThan(0);
  });

  it("totals an empty budget to zero without producing NaN", () => {
    const totals = budgetTotals([], 100_000, period);

    expect(totals.budgetCents).toBe(0);
    expect(totals.safeCents).toBe(100_000);
    expect(Number.isNaN(totals.paceDeltaCents)).toBe(false);
  });
});

describe("allowanceCents", () => {
  it("adds a carried surplus to the standing budget", () => {
    expect(allowanceCents(72_000, 5_000)).toBe(77_000);
  });

  it("subtracts a carried overspend", () => {
    expect(allowanceCents(72_000, -5_000)).toBe(67_000);
  });

  it("floors at zero so a big overspend cannot invert the budget", () => {
    expect(allowanceCents(10_000, -25_000)).toBe(0);
  });
});

describe("monthEndAmounts", () => {
  const budget = 18_000;
  const spent = 23_140;

  it("keeps the same budget and clears any carryover", () => {
    expect(monthEndAmounts(budget, spent).keep).toEqual({
      amountCents: 18_000,
      carryoverCents: 0,
    });
  });

  it("carries the difference without moving the standing budget", () => {
    // The budget stays at $180 and the $51.40 overspend is repaid out of next
    // period's allowance — one bad month does not silently become the norm.
    expect(monthEndAmounts(budget, spent).carry).toEqual({
      amountCents: 18_000,
      carryoverCents: -5_140,
    });
  });

  it("matches the budget to what was actually spent, to the dollar", () => {
    expect(monthEndAmounts(budget, spent).match).toEqual({
      amountCents: 23_100,
      carryoverCents: 0,
    });
  });

  it("carries a surplus forward as a positive", () => {
    expect(monthEndAmounts(15_000, 11_820).carry.carryoverCents).toBe(3_180);
  });
});

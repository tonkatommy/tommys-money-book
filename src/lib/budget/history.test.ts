import { describe, expect, it } from "vitest";
import { payPeriodFor, previousPeriods, utcDate } from "./period";
import {
  allowanceFor,
  budgetHint,
  latestRows,
  periodTotal,
  summariseCategory,
  varianceCents,
  type BudgetRowLike,
  type PeriodCell,
} from "./history";

const ANCHOR = 20;

// The running period on 19/09/2026 is 20 Aug – 19 Sep; the window is the six
// before it, oldest first, which is how the history query hands them over.
// `utcDate` months are 0-based, as `Date.UTC`'s are: 8 is September.
const current = payPeriodFor(utcDate(2026, 8, 19), ANCHOR);
const window = previousPeriods(current, 6, ANCHOR).reverse();
const [feb, mar, apr, may, jun, jul] = window;

function row(over: Partial<BudgetRowLike> = {}): BudgetRowLike {
  return {
    categoryId: "groceries",
    periodStart: feb.start,
    amountCents: 60_000,
    carryoverCents: 0,
    ...over,
  };
}

/** A budgeted cell with no carryover. */
function cell(standingCents: number, spentCents: number, i: number): PeriodCell {
  return {
    period: window[i],
    allowance: {
      standingCents,
      carryoverCents: 0,
      allowanceCents: standingCents,
    },
    spentCents,
  };
}

function unbudgeted(spentCents: number, i: number): PeriodCell {
  return { period: window[i], allowance: null, spentCents };
}

function hint(cells: PeriodCell[], currentStandingCents: number | null = 60_000) {
  return budgetHint({
    categoryId: "groceries",
    cells,
    currentStandingCents,
    isFixed: false,
    estimated: false,
  });
}

describe("the window", () => {
  it("is the six complete periods before the running one, oldest first", () => {
    expect(window.map((p) => p.label)).toEqual([
      "20 Feb – 19 Mar",
      "20 Mar – 19 Apr",
      "20 Apr – 19 May",
      "20 May – 19 Jun",
      "20 Jun – 19 Jul",
      "20 Jul – 19 Aug",
    ]);
  });
});

describe("latestRows", () => {
  it("picks the most recent row on or before the period", () => {
    const rows = [
      row({ periodStart: feb.start, amountCents: 50_000 }),
      row({ periodStart: apr.start, amountCents: 70_000 }),
    ];
    expect(latestRows(rows, mar).get("groceries")?.amountCents).toBe(50_000);
    expect(latestRows(rows, apr).get("groceries")?.amountCents).toBe(70_000);
    expect(latestRows(rows, jul).get("groceries")?.amountCents).toBe(70_000);
  });

  it("ignores a row dated after the period", () => {
    const rows = [row({ periodStart: may.start })];
    expect(latestRows(rows, apr).has("groceries")).toBe(false);
  });

  it("does not depend on the rows arriving sorted", () => {
    const rows = [
      row({ periodStart: feb.start, amountCents: 1 }),
      row({ periodStart: apr.start, amountCents: 3 }),
      row({ periodStart: mar.start, amountCents: 2 }),
    ];
    expect(latestRows(rows, jun).get("groceries")?.amountCents).toBe(3);
    expect(latestRows([...rows].reverse(), jun).get("groceries")?.amountCents).toBe(3);
  });

  it("resolves each category independently", () => {
    const rows = [
      row({ categoryId: "a", periodStart: feb.start, amountCents: 1 }),
      row({ categoryId: "b", periodStart: may.start, amountCents: 2 }),
    ];
    const latest = latestRows(rows, mar);
    expect(latest.get("a")?.amountCents).toBe(1);
    expect(latest.has("b")).toBe(false);
  });
});

describe("allowanceFor", () => {
  it("is null — no budget, not a zero budget — when there is no row", () => {
    expect(allowanceFor(null, mar)).toBeNull();
    expect(allowanceFor(undefined, mar)).toBeNull();
  });

  it("applies carryover in the period the row was written for", () => {
    const carried = row({ periodStart: mar.start, carryoverCents: 5_000 });
    expect(allowanceFor(carried, mar)).toEqual({
      standingCents: 60_000,
      carryoverCents: 5_000,
      allowanceCents: 65_000,
    });
  });

  it("drops carryover on an inherited row, so it cannot compound", () => {
    // Written in March with $50 carried in. April and May inherit the row but
    // not the $50: re-applying it every month is the compounding bug.
    const carried = row({ periodStart: mar.start, carryoverCents: 5_000 });
    for (const later of [apr, may, jul]) {
      expect(allowanceFor(carried, later)).toEqual({
        standingCents: 60_000,
        carryoverCents: 0,
        allowanceCents: 60_000,
      });
    }
  });

  it("floors the allowance at zero when a repaid overspend exceeds the budget", () => {
    const repaying = row({ periodStart: mar.start, carryoverCents: -80_000 });
    expect(allowanceFor(repaying, mar)?.allowanceCents).toBe(0);
  });
});

describe("varianceCents", () => {
  it("is positive under budget and negative over", () => {
    expect(varianceCents(cell(60_000, 55_000, 0))).toBe(5_000);
    expect(varianceCents(cell(60_000, 61_000, 0))).toBe(-1_000);
  });

  it("widens with a refund-driven negative spend rather than clamping it", () => {
    expect(varianceCents(cell(60_000, -2_000, 0))).toBe(62_000);
  });

  it("is null for a period with no budget, not the whole spend as overspend", () => {
    expect(varianceCents(unbudgeted(40_000, 0))).toBeNull();
  });
});

describe("summariseCategory", () => {
  it("counts over and under against the allowance, and exact as neither", () => {
    const summary = summariseCategory([
      cell(60_000, 70_000, 0),
      cell(60_000, 50_000, 1),
      cell(60_000, 60_000, 2),
    ]);
    expect(summary).toMatchObject({ budgetedCount: 3, overCount: 1, underCount: 1 });
  });

  it("leaves no-budget periods out of the counts and the average", () => {
    const summary = summariseCategory([
      unbudgeted(900_000, 0),
      unbudgeted(900_000, 1),
      cell(60_000, 50_000, 2),
      cell(60_000, 70_000, 3),
    ]);
    expect(summary).toEqual({
      budgetedCount: 2,
      overCount: 1,
      underCount: 1,
      averageSpentCents: 60_000,
    });
  });

  it("has a null average, not NaN, when nothing was budgeted", () => {
    const summary = summariseCategory([unbudgeted(1_000, 0), unbudgeted(2_000, 1)]);
    expect(summary.budgetedCount).toBe(0);
    expect(summary.averageSpentCents).toBeNull();
  });

  it("rounds the average to the cent", () => {
    const summary = summariseCategory([
      cell(100, 100, 0),
      cell(100, 100, 1),
      cell(100, 101, 2),
    ]);
    expect(summary.averageSpentCents).toBe(100);
  });
});

describe("budgetHint", () => {
  const overRun = [
    cell(60_000, 72_000, 0),
    cell(60_000, 71_000, 1),
    cell(60_000, 73_000, 2),
  ];

  it("suggests raising a budget consistently overspent by a real margin", () => {
    expect(hint(overRun)).toMatchObject({
      direction: "over",
      standingCents: 60_000,
      averageSpentCents: 72_000,
      suggestedCents: 72_000,
      periods: 3,
      zeroStanding: false,
    });
  });

  it("suggests lowering a budget consistently underspent by a real margin", () => {
    const underRun = [
      cell(60_000, 40_050, 0),
      cell(60_000, 41_000, 1),
      cell(60_000, 39_900, 2),
    ];
    expect(hint(underRun)).toMatchObject({
      direction: "under",
      averageSpentCents: 40_317,
      // Rounded to the dollar, the same as month-end's "match".
      suggestedCents: 40_300,
    });
  });

  it("says nothing with fewer than three budgeted periods", () => {
    expect(hint([unbudgeted(90_000, 0), ...overRun.slice(1)])).toBeNull();
  });

  it("says nothing when the recent periods alternate", () => {
    expect(
      hint([cell(60_000, 90_000, 0), cell(60_000, 30_000, 1), cell(60_000, 90_000, 2)]),
    ).toBeNull();
  });

  it("judges direction on the last three budgeted periods only", () => {
    // Under in Feb and Mar, then over for the three that count.
    const cells = [
      cell(60_000, 70_000, 0),
      cell(60_000, 70_000, 1),
      cell(60_000, 30_000, 2),
      ...[3, 4, 5].map((i) => cell(60_000, 90_000, i)),
    ];
    expect(hint(cells)?.direction).toBe("over");
  });

  it("says nothing when the average contradicts the recent run", () => {
    // Over in the last three, but the older half pulls the average under.
    const cells = [
      cell(60_000, 10_000, 0),
      cell(60_000, 10_000, 1),
      cell(60_000, 10_000, 2),
      ...[3, 4, 5].map((i) => cell(60_000, 61_000, i)),
    ];
    expect(hint(cells)).toBeNull();
  });

  it("needs at least 10% as well as $20", () => {
    // $50 over on a $600 budget clears $20 but not 10% ($60).
    const cells = [0, 1, 2].map((i) => cell(60_000, 65_000, i));
    expect(hint(cells)).toBeNull();
  });

  it("needs at least $20 as well as 10%", () => {
    // $15 over on a $50 budget is 30% but under $20.
    const cells = [0, 1, 2].map((i) => cell(5_000, 6_500, i));
    expect(hint(cells, 5_000)).toBeNull();
  });

  it("fires at exactly 10% and $20", () => {
    const cells = [0, 1, 2].map((i) => cell(20_000, 22_000, i));
    expect(hint(cells, 20_000)?.direction).toBe("over");
  });

  it("compares against the budget as it stands now, not as it stood", () => {
    // Already raised to $720 this period: the suggestion has been taken.
    expect(hint(overRun, 72_000)).toBeNull();
  });

  it("handles a $0 standing budget without dividing by it", () => {
    const cells = [0, 1, 2].map((i) => cell(0, 4_000, i));
    expect(hint(cells, 0)).toMatchObject({
      direction: "over",
      zeroStanding: true,
      suggestedCents: 4_000,
    });
  });

  it("refuses to suggest from a negative average", () => {
    const cells = [0, 1, 2].map((i) => cell(5_000, -3_000, i));
    expect(hint(cells, 5_000)).toBeNull();
  });

  it("refuses when there is no budget now", () => {
    expect(hint(overRun, null)).toBeNull();
  });

  it("judges direction against the standing budget, not a carried allowance", () => {
    // $100 carried in each period lifts the allowance to $700 but the budget
    // is still $600, and spending $650 is over the budget that was set.
    const carried = [0, 1, 2].map<PeriodCell>((i) => ({
      period: window[i],
      allowance: { standingCents: 60_000, carryoverCents: 10_000, allowanceCents: 70_000 },
      spentCents: 68_000,
    }));
    expect(hint(carried)?.direction).toBe("over");
  });

  it("carries the bill flags through for the wording", () => {
    const result = budgetHint({
      categoryId: "insurance",
      cells: overRun,
      currentStandingCents: 60_000,
      isFixed: true,
      estimated: true,
    });
    expect(result).toMatchObject({ isFixed: true, estimated: true });
  });
});

describe("periodTotal", () => {
  it("sums allowance and spent over budgeted categories only", () => {
    const total = periodTotal(jun, [
      cell(60_000, 50_000, 4),
      cell(20_000, 25_000, 4),
      unbudgeted(9_000, 4),
    ]);
    expect(total).toMatchObject({
      allowanceCents: 80_000,
      spentCents: 75_000,
      varianceCents: 5_000,
      // Kept apart: neither dropped nor counted as an overspend.
      unbudgetedSpentCents: 9_000,
    });
  });

  it("has a null allowance and variance when nothing was budgeted", () => {
    const total = periodTotal(feb, [unbudgeted(10_000, 0), unbudgeted(5_000, 0)]);
    expect(total).toMatchObject({
      allowanceCents: null,
      varianceCents: null,
      spentCents: 0,
      unbudgetedSpentCents: 15_000,
    });
  });

  it("counts an explicit $0 budget as budgeted", () => {
    const total = periodTotal(feb, [cell(0, 1_000, 0)]);
    expect(total.allowanceCents).toBe(0);
    expect(total.varianceCents).toBe(-1_000);
  });
});

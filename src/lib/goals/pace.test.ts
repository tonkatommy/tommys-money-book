// The savings-goal pace arithmetic. The cases that matter most are the ones
// that would otherwise render a confident wrong figure: a required amount
// rounded down so paying it falls short, an average carrying a fraction of a
// cent, a truncated first period read as a small contribution, and a
// projection divided by zero or by a shrinking balance.

import { describe, expect, it } from "vitest";
import { payPeriodFor, previousPeriods, utcDate } from "@/lib/budget/period";
import {
  MAX_PROJECTION_PERIODS,
  averageContributionCents,
  countedPeriods,
  goalPace,
  periodsLeft,
  progress,
  projection,
  requiredPerPeriodCents,
  type FlowPeriod,
} from "./pace";

const ANCHOR = 20;

// 02/10/2026 sits in the 20 Sep – 19 Oct period. `utcDate` months are
// 0-based, as `Date.UTC`'s are: 9 is October.
const TODAY = utcDate(2026, 9, 2);

// The six complete periods before the running one, oldest first: 20 Mar –
// 19 Apr through 20 Aug – 19 Sep.
const window = previousPeriods(payPeriodFor(TODAY, ANCHOR), 6, ANCHOR).reverse();

function flows(...amounts: number[]): FlowPeriod[] {
  return amounts.map((netFlowCents, i) => ({ period: window[i], netFlowCents }));
}

describe("progress", () => {
  it("measures the balance against the target", () => {
    const p = progress(25_000, 100_000);
    expect(p.remainingCents).toBe(75_000);
    expect(p.reached).toBe(false);
    expect(p.overshootCents).toBe(0);
    expect(p.percent).toBe(25);
    expect(p.barPercent).toBe(25);
  });

  it("reports an overshoot instead of a negative remainder once reached", () => {
    const p = progress(120_000, 100_000);
    expect(p.reached).toBe(true);
    expect(p.overshootCents).toBe(20_000);
    expect(p.percent).toBe(120);
    expect(p.barPercent).toBe(100);
  });

  it("counts exactly the target as reached", () => {
    expect(progress(100_000, 100_000).reached).toBe(true);
  });

  it("keeps an overdrawn balance's figure but never draws the bar backwards", () => {
    const p = progress(-5_000, 100_000);
    expect(p.percent).toBe(-5);
    expect(p.barPercent).toBe(0);
    expect(p.remainingCents).toBe(105_000);
  });

  it("returns no percentage for a non-positive target rather than dividing by it", () => {
    expect(progress(5_000, 0).percent).toBeNull();
    expect(progress(5_000, 0).barPercent).toBeNull();
    expect(progress(5_000, -100).percent).toBeNull();
  });
});

describe("periodsLeft", () => {
  it("is 1 when the target falls in the current period", () => {
    expect(periodsLeft(TODAY, utcDate(2026, 9, 10), ANCHOR)).toBe(1);
  });

  it("is 1 on the last day of the current period, and 2 the day after", () => {
    expect(periodsLeft(TODAY, utcDate(2026, 9, 19), ANCHOR)).toBe(1);
    expect(periodsLeft(TODAY, utcDate(2026, 9, 20), ANCHOR)).toBe(2);
  });

  it("is 1 when the target is today", () => {
    expect(periodsLeft(TODAY, TODAY, ANCHOR)).toBe(1);
  });

  it("is 0 once the date has passed", () => {
    expect(periodsLeft(TODAY, utcDate(2026, 9, 1), ANCHOR)).toBe(0);
  });

  it("crosses the year boundary", () => {
    // 20 Sep, 20 Oct, 20 Nov, 20 Dec, 20 Jan: the period containing 25 Jan
    // 2027 is the fifth.
    expect(periodsLeft(TODAY, utcDate(2027, 0, 25), ANCHOR)).toBe(5);
  });

  it("clamps an anchor of 31 across February without skipping a period", () => {
    // Periods start 31 Jan, 28 Feb, 31 Mar. From 1 Feb, a target of 1 Mar is
    // in the second, and 31 Mar starts the third.
    const today = utcDate(2027, 1, 1);
    expect(periodsLeft(today, utcDate(2027, 1, 27), 31)).toBe(1);
    expect(periodsLeft(today, utcDate(2027, 2, 1), 31)).toBe(2);
    expect(periodsLeft(today, utcDate(2027, 2, 31), 31)).toBe(3);
  });
});

describe("requiredPerPeriodCents", () => {
  it("rounds UP, so paying it every period actually reaches the target", () => {
    // $100.00 over 3 periods: 3333 × 3 is 9999, a cent short.
    expect(requiredPerPeriodCents(10_000, 3)).toBe(3_334);
  });

  it("leaves an exact division alone", () => {
    expect(requiredPerPeriodCents(9_000, 3)).toBe(3_000);
  });

  it("is null with no periods left, not a divide-by-zero", () => {
    expect(requiredPerPeriodCents(10_000, 0)).toBeNull();
  });

  it("is 0 once reached, never negative", () => {
    expect(requiredPerPeriodCents(0, 3)).toBe(0);
    expect(requiredPerPeriodCents(-5_000, 3)).toBe(0);
  });
});

describe("countedPeriods and averageContributionCents", () => {
  it("averages six periods", () => {
    expect(averageContributionCents(flows(100, 200, 300, 400, 500, 600), window[0].start)).toBe(350);
  });

  it("rounds a sum that doesn't divide to whole cents", () => {
    // 10,001 over six is 1,666.83...
    const average = averageContributionCents(
      flows(10_001, 0, 0, 0, 0, 0),
      window[0].start,
    );
    expect(average).toBe(1_667);
    expect(Number.isInteger(average)).toBe(true);
  });

  it("drops the period containing historyStartDate when it starts before it", () => {
    // History starts mid-May: the 20 Apr – 19 May period is truncated, and
    // so is everything before it.
    const historyStart = utcDate(2026, 4, 5);
    const counted = countedPeriods(flows(1, 2, 3, 4, 5, 6), historyStart);
    expect(counted.map((entry) => entry.netFlowCents)).toEqual([3, 4, 5, 6]);
  });

  it("keeps a period whose start is exactly historyStartDate", () => {
    const counted = countedPeriods(flows(1, 2, 3, 4, 5, 6), window[2].start);
    expect(counted.map((entry) => entry.netFlowCents)).toEqual([3, 4, 5, 6]);
  });

  it("averages only what counts, not six periods padded with zeros", () => {
    expect(averageContributionCents(flows(0, 0, 0, 0, 5_000, 7_000), window[4].start)).toBe(6_000);
  });

  it("is null, not 0, when no period counts", () => {
    expect(averageContributionCents(flows(5_000), utcDate(2026, 9, 1))).toBeNull();
    expect(averageContributionCents(flows(5_000, 5_000), null)).toBeNull();
    expect(averageContributionCents([], window[0].start)).toBeNull();
  });

  it("lets a withdrawal pull the average down rather than ignoring it", () => {
    expect(averageContributionCents(flows(10_000, -40_000), window[0].start)).toBe(-15_000);
  });

  it("never returns -0", () => {
    expect(Object.is(averageContributionCents(flows(-1, 0, 0), window[0].start), 0)).toBe(true);
  });
});

describe("projection", () => {
  it("reports the last day of the period the target is reached in", () => {
    // $1,000 at $300 a period: 4 periods, counting this one. The fourth is
    // 20 Dec – 19 Jan.
    expect(projection(100_000, 30_000, TODAY, ANCHOR)).toEqual({
      status: "on-date",
      by: utcDate(2027, 0, 19),
      periods: 4,
    });
  });

  it("lands in the current period when one period's average covers it", () => {
    expect(projection(5_000, 5_000, TODAY, ANCHOR)).toEqual({
      status: "on-date",
      by: utcDate(2026, 9, 19),
      periods: 1,
    });
  });

  it("refuses a zero or negative average instead of dividing by it", () => {
    expect(projection(100_000, 0, TODAY, ANCHOR)).toEqual({ status: "not-growing" });
    expect(projection(100_000, -2_000, TODAY, ANCHOR)).toEqual({ status: "not-growing" });
  });

  it("says no history rather than not growing when there is no average", () => {
    expect(projection(100_000, null, TODAY, ANCHOR)).toEqual({ status: "no-history" });
  });

  it("has nothing to project once reached", () => {
    expect(projection(0, 5_000, TODAY, ANCHOR)).toEqual({ status: "reached" });
    expect(projection(-100, null, TODAY, ANCHOR)).toEqual({ status: "reached" });
  });

  it("stops at a horizon rather than walking a century of periods", () => {
    expect(
      projection(MAX_PROJECTION_PERIODS + 1, 1, TODAY, ANCHOR),
    ).toEqual({ status: "too-far" });
    expect(projection(MAX_PROJECTION_PERIODS, 1, TODAY, ANCHOR).status).toBe("on-date");
  });
});

describe("goalPace", () => {
  const base = {
    balanceCents: 40_000,
    targetCents: 100_000,
    targetDate: utcDate(2027, 2, 15), // in the 20 Feb – 19 Mar period: 6 left
    historyStartDate: window[0].start,
    history: flows(10_000, 10_000, 10_000, 10_000, 10_000, 10_000),
    today: TODAY,
    anchorDay: ANCHOR,
  };

  it("is on track when the average covers the required amount", () => {
    const pace = goalPace(base);
    expect(pace.periodsLeft).toBe(6);
    expect(pace.requiredPerPeriodCents).toBe(10_000);
    expect(pace.averageContributionCents).toBe(10_000);
    expect(pace.averagedOver).toBe(6);
    expect(pace.onTrack).toBe(true);
  });

  it("is behind when it doesn't", () => {
    expect(goalPace({ ...base, history: flows(9_999, 9_999, 9_999, 9_999, 9_999, 9_999) }).onTrack).toBe(false);
  });

  it("has no required pace or verdict without a target date", () => {
    const pace = goalPace({ ...base, targetDate: null });
    expect(pace.periodsLeft).toBeNull();
    expect(pace.requiredPerPeriodCents).toBeNull();
    expect(pace.onTrack).toBeNull();
    expect(pace.projection.status).toBe("on-date");
  });

  it("has no required pace once the date has passed", () => {
    const pace = goalPace({ ...base, targetDate: utcDate(2026, 8, 1) });
    expect(pace.periodsLeft).toBe(0);
    expect(pace.requiredPerPeriodCents).toBeNull();
    expect(pace.onTrack).toBeNull();
  });

  it("calls a reached goal on track whatever the history", () => {
    expect(goalPace({ ...base, balanceCents: 100_000, history: [] }).onTrack).toBe(true);
  });

  it("gives no verdict without history", () => {
    const pace = goalPace({ ...base, historyStartDate: null });
    expect(pace.averageContributionCents).toBeNull();
    expect(pace.averagedOver).toBe(0);
    expect(pace.onTrack).toBeNull();
  });
});

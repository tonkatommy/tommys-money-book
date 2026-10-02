// The savings-goal pace arithmetic. The cases that matter most are the ones
// that would otherwise render a confident wrong figure: a required amount
// rounded down so paying it falls short, a period whose payday money has
// already landed counted as one still to pay, an average carrying a fraction
// of a cent, a truncated period read as a small contribution, a dormant
// bucket's real zeros dropped so one deposit reads as a habit, and a
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
    expect(periodsLeft(TODAY, utcDate(2026, 9, 10), ANCHOR, false)).toBe(1);
  });

  it("is 1 on the last day of the current period, and 2 the day after", () => {
    expect(periodsLeft(TODAY, utcDate(2026, 9, 19), ANCHOR, false)).toBe(1);
    expect(periodsLeft(TODAY, utcDate(2026, 9, 20), ANCHOR, false)).toBe(2);
  });

  it("is 1 when the target is today", () => {
    expect(periodsLeft(TODAY, TODAY, ANCHOR, false)).toBe(1);
  });

  it("drops the current period once this period's money has landed", () => {
    // The review case: $100 standing order already in on 20/09, target by
    // 19/03/2027. Six periods by the calendar, five paydays still to come.
    expect(periodsLeft(TODAY, utcDate(2027, 2, 19), ANCHOR, false)).toBe(6);
    expect(periodsLeft(TODAY, utcDate(2027, 2, 19), ANCHOR, true)).toBe(5);
  });

  it("is 0 when the date hasn't passed but no payday is left before it", () => {
    expect(periodsLeft(TODAY, utcDate(2026, 9, 19), ANCHOR, true)).toBe(0);
  });

  it("stays 0 for a passed date whether or not money landed", () => {
    expect(periodsLeft(TODAY, utcDate(2026, 9, 1), ANCHOR, true)).toBe(0);
  });

  it("is 0 once the date has passed", () => {
    expect(periodsLeft(TODAY, utcDate(2026, 9, 1), ANCHOR, false)).toBe(0);
  });

  it("crosses the year boundary", () => {
    // 20 Sep, 20 Oct, 20 Nov, 20 Dec, 20 Jan: the period containing 25 Jan
    // 2027 is the fifth.
    expect(periodsLeft(TODAY, utcDate(2027, 0, 25), ANCHOR, false)).toBe(5);
  });

  it("clamps an anchor of 31 across February without skipping a period", () => {
    // Periods start 31 Jan, 28 Feb, 31 Mar. From 1 Feb, a target of 1 Mar is
    // in the second, and 31 Mar starts the third.
    const today = utcDate(2027, 1, 1);
    expect(periodsLeft(today, utcDate(2027, 1, 27), 31, false)).toBe(1);
    expect(periodsLeft(today, utcDate(2027, 2, 1), 31, false)).toBe(2);
    expect(periodsLeft(today, utcDate(2027, 2, 31), 31, false)).toBe(3);
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

  it("drops a period the feed's history starts partway through", () => {
    // Coverage starts mid-May: the 20 Apr – 19 May period is truncated, and
    // so is everything before it.
    const coverageStart = utcDate(2026, 4, 5);
    const counted = countedPeriods(flows(1, 2, 3, 4, 5, 6), coverageStart);
    expect(counted.map((entry) => entry.netFlowCents)).toEqual([3, 4, 5, 6]);
  });

  it("keeps a period whose start is exactly the coverage start", () => {
    const counted = countedPeriods(flows(1, 2, 3, 4, 5, 6), window[2].start);
    expect(counted.map((entry) => entry.netFlowCents)).toEqual([3, 4, 5, 6]);
  });

  it("leaves out periods before the feed's history rather than reading them as zeros", () => {
    expect(averageContributionCents(flows(0, 0, 0, 0, 5_000, 7_000), window[4].start)).toBe(6_000);
  });

  it("counts a dormant bucket's empty periods as the real zeros they are", () => {
    // The review case: the feed reaches back a year, the bucket's first-ever
    // deposit is $500 in the newest period. Averaged from the deposit alone
    // it would read $500 a period; the true six-period figure is $83.33.
    const coverageStart = utcDate(2025, 6, 16);
    expect(averageContributionCents(flows(0, 0, 0, 0, 0, 50_000), coverageStart)).toBe(8_333);
  });

  it("reads an account with no transactions inside the feed's history as $0, not no history", () => {
    expect(averageContributionCents(flows(0, 0, 0, 0, 0, 0), utcDate(2025, 6, 16))).toBe(0);
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
    expect(projection(100_000, 30_000, TODAY, ANCHOR, false)).toEqual({
      status: "on-date",
      by: utcDate(2027, 0, 19),
      periods: 4,
    });
  });

  it("lands in the current period when one period's average covers it", () => {
    expect(projection(5_000, 5_000, TODAY, ANCHOR, false)).toEqual({
      status: "on-date",
      by: utcDate(2026, 9, 19),
      periods: 1,
    });
  });

  it("starts from next payday once this period's money has landed", () => {
    // Same $1,000 at $300, but this period is already paid: the four
    // contributions are 20 Oct, 20 Nov, 20 Dec and 20 Jan.
    expect(projection(100_000, 30_000, TODAY, ANCHOR, true)).toEqual({
      status: "on-date",
      by: utcDate(2027, 1, 19),
      periods: 4,
    });
    expect(projection(5_000, 5_000, TODAY, ANCHOR, true)).toEqual({
      status: "on-date",
      by: utcDate(2026, 10, 19),
      periods: 1,
    });
  });

  it("refuses a zero or negative average instead of dividing by it", () => {
    expect(projection(100_000, 0, TODAY, ANCHOR, false)).toEqual({ status: "not-growing" });
    expect(projection(100_000, -2_000, TODAY, ANCHOR, false)).toEqual({ status: "not-growing" });
  });

  it("says no history rather than not growing when there is no average", () => {
    expect(projection(100_000, null, TODAY, ANCHOR, false)).toEqual({ status: "no-history" });
  });

  it("has nothing to project once reached", () => {
    expect(projection(0, 5_000, TODAY, ANCHOR, false)).toEqual({ status: "reached" });
    expect(projection(-100, null, TODAY, ANCHOR, false)).toEqual({ status: "reached" });
  });

  it("stops at a horizon rather than walking a century of periods", () => {
    expect(
      projection(MAX_PROJECTION_PERIODS + 1, 1, TODAY, ANCHOR, false),
    ).toEqual({ status: "too-far" });
    expect(projection(MAX_PROJECTION_PERIODS, 1, TODAY, ANCHOR, false).status).toBe("on-date");
  });
});

describe("goalPace", () => {
  const base = {
    balanceCents: 40_000,
    targetCents: 100_000,
    targetDate: utcDate(2027, 2, 15), // in the 20 Feb – 19 Mar period: 6 left
    coverageStart: window[0].start,
    history: flows(10_000, 10_000, 10_000, 10_000, 10_000, 10_000),
    currentPeriodHasInflow: false,
    today: TODAY,
    anchorDay: ANCHOR,
  };

  it("is behind, not on track, in the review's standing-order case", () => {
    // $100 already in this period, $700 by 19/03/2027, $100 a period going
    // in. Five paydays left, so $120 is needed and $100 isn't enough.
    const pace = goalPace({
      ...base,
      balanceCents: 10_000,
      targetCents: 70_000,
      targetDate: utcDate(2027, 2, 19),
      currentPeriodHasInflow: true,
    });
    expect(pace.periodsLeft).toBe(5);
    expect(pace.requiredPerPeriodCents).toBe(12_000);
    expect(pace.onTrack).toBe(false);
  });

  it("is behind when no payday is left before an unpassed date", () => {
    const pace = goalPace({
      ...base,
      targetDate: utcDate(2026, 9, 19),
      currentPeriodHasInflow: true,
    });
    expect(pace.periodsLeft).toBe(0);
    expect(pace.datePassed).toBe(false);
    expect(pace.requiredPerPeriodCents).toBeNull();
    expect(pace.onTrack).toBe(false);
  });

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

  it("has no required pace, and is behind, once the date has passed", () => {
    const pace = goalPace({ ...base, targetDate: utcDate(2026, 8, 1) });
    expect(pace.periodsLeft).toBe(0);
    expect(pace.datePassed).toBe(true);
    expect(pace.requiredPerPeriodCents).toBeNull();
    expect(pace.onTrack).toBe(false);
  });

  it("calls a reached goal on track whatever the history", () => {
    expect(goalPace({ ...base, balanceCents: 100_000, history: [] }).onTrack).toBe(true);
  });

  it("gives no verdict without history", () => {
    const pace = goalPace({ ...base, coverageStart: null });
    expect(pace.averageContributionCents).toBeNull();
    expect(pace.averagedOver).toBe(0);
    expect(pace.onTrack).toBeNull();
  });
});

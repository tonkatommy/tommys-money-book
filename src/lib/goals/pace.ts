// Savings goal arithmetic — the pure half. Phase 4c spec §4.
//
// A goal's progress is its account's Akahu balance; nothing here stores or
// derives a balance of its own. What this module adds is pace: how much has
// to go in per pay period to hit the date, how much actually has been going
// in, and when the target falls at that rate.
//
// Three things to know before changing anything here:
//
// 1. PAY PERIODS, NOT MONTHS. Standing orders into the buckets leave the
//    Income Bucket on payday, so a calendar-month pace would split every
//    contribution across two months. Every period comes from `payPeriodFor`,
//    so short months and anchors past the 28th clamp exactly as the budget's
//    do, with no second implementation of that rule.
//
// 2. AMOUNTS AS STORED. Net flow is every transaction on the account, signed
//    as the bank signed it: positive in, negative out. The budget's
//    expense-sign flip (invariant 2) does not apply here, and nothing in this
//    module flips a sign.
//
// 3. NO NUMBER WITHOUT A BASIS. A required contribution over zero periods, an
//    average over no history, a projection from a shrinking balance — each is
//    `null` or an explicit status, never 0, NaN, Infinity or a date in the
//    past. Those are the values that render as a confident wrong figure.

import { payPeriodFor, type PayPeriod } from "@/lib/budget/period";

/** Where the balance stands against the target. */
export type GoalProgress = {
  /** Target minus balance. Negative once reached — see `overshootCents`. */
  remainingCents: number;
  reached: boolean;
  /** How far past the target the balance is. 0 until reached. */
  overshootCents: number;
  /**
   * True percentage, for the text. Can exceed 100 or go below 0. `null` for a
   * non-positive target, which the write path refuses but this does not
   * assume.
   */
  percent: number | null;
  /** Clamped to 0–100, for the bar width only. Never draws backwards. */
  barPercent: number | null;
};

export function progress(balanceCents: number, targetCents: number): GoalProgress {
  const remainingCents = targetCents - balanceCents;
  const reached = remainingCents <= 0;

  // Percentages are display, not money, so float division is fine here. The
  // money figures above stay integer cents.
  const percent = targetCents > 0 ? (balanceCents / targetCents) * 100 : null;

  return {
    remainingCents,
    reached,
    overshootCents: reached ? -remainingCents : 0,
    percent,
    barPercent: percent === null ? null : Math.min(100, Math.max(0, percent)),
  };
}

/**
 * Pay periods left to save in: the current one, up to and including the one
 * containing `targetDate`.
 *
 * The current period counts because money can still go in this period. A
 * target date before `today` is 0, the "date passed" state, which has no
 * required contribution at all.
 *
 * `today` and `targetDate` are UTC-midnight calendar dates — `nzToday()` and
 * a stored `@db.Date` — so the comparison is a date comparison, not an
 * instant one.
 */
export function periodsLeft(
  today: Date,
  targetDate: Date,
  anchorDay: number,
): number {
  if (targetDate.getTime() < today.getTime()) return 0;

  let period = payPeriodFor(today, anchorDay);
  let count = 1;
  while (targetDate.getTime() > period.end.getTime()) {
    period = payPeriodFor(period.nextPayday, anchorDay);
    count++;
  }
  return count;
}

/**
 * What has to go in each period to reach the target by the date.
 *
 * Rounded UP. Paying the suggested amount every period has to actually reach
 * the target: rounding down leaves the goal a few cents short on the last
 * day, which reads as a bug however small it is. `null` when there are no
 * periods left, because a contribution spread over zero periods doesn't
 * exist. 0 once reached: nothing more is needed, and a negative "required"
 * figure would read as permission to withdraw.
 */
export function requiredPerPeriodCents(
  remainingCents: number,
  periods: number,
): number | null {
  if (periods <= 0) return null;
  if (remainingCents <= 0) return 0;
  // Integer cents over an integer count. The quotient of two safe integers is
  // exact when it is whole, so `ceil` only moves a genuine fraction.
  return Math.ceil(remainingCents / periods);
}

/** One complete pay period's net movement on the goal's account. */
export type FlowPeriod = {
  period: PayPeriod;
  /** Sum of every settled transaction on the account in the period. */
  netFlowCents: number;
};

/**
 * The periods whose flow can be trusted: those starting on or after the
 * account's `historyStartDate`.
 *
 * The period containing `historyStartDate` is incomplete when it starts
 * before it — whatever moved between the period start and the first imported
 * transaction isn't in the data, so it would read as a smaller contribution
 * than was made. That costs a genuinely new bucket its first, partial period,
 * because the app can't tell "opened mid-period" from "Akahu's history starts
 * mid-period", and understating the history beats misstating it.
 *
 * A null `historyStartDate` means nothing has ever been imported for the
 * account, so no period qualifies.
 */
export function countedPeriods(
  periods: readonly FlowPeriod[],
  historyStartDate: Date | null,
): FlowPeriod[] {
  if (historyStartDate === null) return [];
  const cutoff = historyStartDate.getTime();
  return periods.filter((entry) => entry.period.start.getTime() >= cutoff);
}

/**
 * Mean net flow over the periods that count, in whole cents.
 *
 * `Math.round`, as `averageSpentCents` in `budget/history.ts` does: a mean of
 * integer cents is fractional whenever the sum doesn't divide, and the
 * fraction would otherwise ride into the on-track comparison and the
 * projection. `null` — not 0 — when no period counts: no history is not the
 * same as putting nothing in.
 */
export function averageContributionCents(
  periods: readonly FlowPeriod[],
  historyStartDate: Date | null,
): number | null {
  const counted = countedPeriods(periods, historyStartDate);
  if (counted.length === 0) return null;

  const total = counted.reduce((sum, entry) => sum + entry.netFlowCents, 0);
  // `+ 0` turns the -0 that Math.round(-0.4) gives into 0, so a tiny net
  // withdrawal doesn't render as "-$0.00".
  return Math.round(total / counted.length) + 0;
}

/**
 * Beyond this many periods a projection is a statement about the next
 * century, not a plan. It also bounds the walk below when the average is a
 * few cents against a large remainder.
 */
export const MAX_PROJECTION_PERIODS = 600;

export type Projection =
  | { status: "reached" }
  | { status: "no-history" }
  /** Average at or below zero: the balance isn't growing at this rate. */
  | { status: "not-growing" }
  | { status: "too-far" }
  /** Reached by `by`, the last day of the `periods`-th period from now. */
  | { status: "on-date"; by: Date; periods: number };

/**
 * When the target falls at the recent average.
 *
 * Counts the current period as the first, consistent with `periodsLeft`, and
 * reports the LAST day of the period the target is reached in. Payday at the
 * start of that period would be the optimistic reading: it assumes the
 * period's contribution lands on day one, which a top-up rather than a
 * standing order doesn't.
 */
export function projection(
  remainingCents: number,
  averageCents: number | null,
  today: Date,
  anchorDay: number,
): Projection {
  if (remainingCents <= 0) return { status: "reached" };
  if (averageCents === null) return { status: "no-history" };
  // Dividing by zero gives Infinity and by a negative gives a date in the
  // past. Both have to stop here rather than reach the page.
  if (averageCents <= 0) return { status: "not-growing" };

  const periods = Math.ceil(remainingCents / averageCents);
  if (periods > MAX_PROJECTION_PERIODS) return { status: "too-far" };

  let period = payPeriodFor(today, anchorDay);
  for (let i = 1; i < periods; i++) {
    period = payPeriodFor(period.nextPayday, anchorDay);
  }
  return { status: "on-date", by: period.end, periods };
}

/** Everything the goal card shows about pace, in one call. */
export type GoalPace = {
  progress: GoalProgress;
  /** `null` when the goal has no target date. */
  periodsLeft: number | null;
  /** `null` with no target date, or when the date has passed. */
  requiredPerPeriodCents: number | null;
  averageContributionCents: number | null;
  /** How many periods the average is over — the page says so. */
  averagedOver: number;
  /**
   * `null` when there's nothing to compare: no date, date passed, or no
   * history. A reached goal is on track.
   */
  onTrack: boolean | null;
  projection: Projection;
};

export function goalPace(input: {
  balanceCents: number;
  targetCents: number;
  targetDate: Date | null;
  historyStartDate: Date | null;
  /** Complete periods only — the running period is the caller's to exclude. */
  history: readonly FlowPeriod[];
  today: Date;
  anchorDay: number;
}): GoalPace {
  const goalProgress = progress(input.balanceCents, input.targetCents);

  const left =
    input.targetDate === null
      ? null
      : periodsLeft(input.today, input.targetDate, input.anchorDay);
  const required =
    left === null ? null : requiredPerPeriodCents(goalProgress.remainingCents, left);

  const average = averageContributionCents(input.history, input.historyStartDate);

  let onTrack: boolean | null = null;
  if (goalProgress.reached) onTrack = true;
  else if (required !== null && average !== null) onTrack = average >= required;

  return {
    progress: goalProgress,
    periodsLeft: left,
    requiredPerPeriodCents: required,
    averageContributionCents: average,
    averagedOver: countedPeriods(input.history, input.historyStartDate).length,
    onTrack,
    projection: projection(
      goalProgress.remainingCents,
      average,
      input.today,
      input.anchorDay,
    ),
  };
}

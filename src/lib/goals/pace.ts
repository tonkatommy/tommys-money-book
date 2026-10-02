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
 * Pay periods left to save in: paydays still to come on or before
 * `targetDate`, plus the current period only if nothing has come in yet.
 *
 * The buckets are fed by standing orders on payday, and "needed each pay
 * period" is in effect an instruction for what to set one to. So the count is
 * of contributions still to make, not of calendar periods. Counting the
 * current period after its payday money had already landed was the original
 * rule, and it was one period optimistic: $100 already in on the 20th, $700
 * by March, read as six periods of $100 and "on track" when only five
 * paydays remained and the goal would finish $100 short. Any inflow counts as
 * "this period's money has landed", interest included. That errs towards one
 * fewer period, never one more, which is the direction a savings plan should
 * be wrong in.
 *
 * Two different zeros come out of this, and `goalPace` tells them apart with
 * `targetDate < today`: the date has passed, or it hasn't but no payday is
 * left before it.
 *
 * `today` and `targetDate` are UTC-midnight calendar dates — `nzToday()` and
 * a stored `@db.Date` — so the comparison is a date comparison, not an
 * instant one.
 */
export function periodsLeft(
  today: Date,
  targetDate: Date,
  anchorDay: number,
  currentPeriodHasInflow: boolean,
): number {
  if (targetDate.getTime() < today.getTime()) return 0;

  let period = payPeriodFor(today, anchorDay);
  let count = 1;
  while (targetDate.getTime() > period.end.getTime()) {
    period = payPeriodFor(period.nextPayday, anchorDay);
    count++;
  }
  return currentPeriodHasInflow ? count - 1 : count;
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
 * The periods whose flow can be trusted: those starting on or after
 * `coverageStart`, the date the bank feed's history begins.
 *
 * A period that starts before the feed's history does is incomplete:
 * whatever moved before the data begins isn't in it, so it would read as a
 * smaller contribution than was made.
 *
 * This is deliberately NOT the account's own `historyStartDate`, which sync
 * sets to the account's first transaction. Using that was the original rule,
 * and on a dormant bucket it went wrong both ways: an account with no
 * transactions read as "no history" when the truth was "nothing going in",
 * and the period after a first-ever deposit would be averaged alone, the
 * genuinely empty periods before it dropped, projecting a goal several times
 * too optimistically. A period before an account's first transaction but
 * inside the feed's history is a real zero, whether the account was dormant
 * or didn't exist yet. Either way, nothing was put in.
 *
 * The caller passes the earliest first transaction across every account at
 * the same bank (see `query.ts`). That can only be on or after the feed's
 * true start, so it can never admit a truncated period; at worst it drops
 * one that was in fact covered. A null `coverageStart` means the bank has
 * never returned a transaction, so no period qualifies.
 */
export function countedPeriods(
  periods: readonly FlowPeriod[],
  coverageStart: Date | null,
): FlowPeriod[] {
  if (coverageStart === null) return [];
  const cutoff = coverageStart.getTime();
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
  coverageStart: Date | null,
): number | null {
  const counted = countedPeriods(periods, coverageStart);
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
 * The first contribution is the current period's only if nothing has come
 * in yet, otherwise next payday's: the same rule as `periodsLeft`, for the
 * same reason. Reports the LAST day of the period the target is reached in.
 * Payday at the start of that period would be the optimistic reading: it
 * assumes the period's contribution lands on day one, which a top-up rather
 * than a standing order doesn't.
 */
export function projection(
  remainingCents: number,
  averageCents: number | null,
  today: Date,
  anchorDay: number,
  currentPeriodHasInflow: boolean,
): Projection {
  if (remainingCents <= 0) return { status: "reached" };
  if (averageCents === null) return { status: "no-history" };
  // Dividing by zero gives Infinity and by a negative gives a date in the
  // past. Both have to stop here rather than reach the page.
  if (averageCents <= 0) return { status: "not-growing" };

  const periods = Math.ceil(remainingCents / averageCents);
  if (periods > MAX_PROJECTION_PERIODS) return { status: "too-far" };

  let period = payPeriodFor(today, anchorDay);
  if (currentPeriodHasInflow) period = payPeriodFor(period.nextPayday, anchorDay);
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
  /**
   * The target date is before today. Tells the two zeros of `periodsLeft`
   * apart: passed, or not passed but no payday left before it.
   */
  datePassed: boolean;
  /** `null` with no target date, or no periods left. */
  requiredPerPeriodCents: number | null;
  averageContributionCents: number | null;
  /** How many periods the average is over — the page says so. */
  averagedOver: number;
  /**
   * A reached goal is on track. One with money still to go and no periods
   * left is not, whether the date has passed or no payday remains before it.
   * Otherwise `null` when there's nothing to compare: no date, or no history.
   */
  onTrack: boolean | null;
  projection: Projection;
};

export function goalPace(input: {
  balanceCents: number;
  targetCents: number;
  targetDate: Date | null;
  /** Where the bank feed's history begins. See `countedPeriods`. */
  coverageStart: Date | null;
  /** Complete periods only — the running period is the caller's to exclude. */
  history: readonly FlowPeriod[];
  /** Has any money come in during the running period so far? */
  currentPeriodHasInflow: boolean;
  today: Date;
  anchorDay: number;
}): GoalPace {
  const goalProgress = progress(input.balanceCents, input.targetCents);

  const left =
    input.targetDate === null
      ? null
      : periodsLeft(
          input.today,
          input.targetDate,
          input.anchorDay,
          input.currentPeriodHasInflow,
        );
  const required =
    left === null ? null : requiredPerPeriodCents(goalProgress.remainingCents, left);

  const average = averageContributionCents(input.history, input.coverageStart);

  let onTrack: boolean | null = null;
  if (goalProgress.reached) onTrack = true;
  else if (left === 0) onTrack = false;
  else if (required !== null && average !== null) onTrack = average >= required;

  return {
    progress: goalProgress,
    periodsLeft: left,
    datePassed:
      input.targetDate !== null && input.targetDate.getTime() < input.today.getTime(),
    requiredPerPeriodCents: required,
    averageContributionCents: average,
    averagedOver: countedPeriods(input.history, input.coverageStart).length,
    onTrack,
    projection: projection(
      goalProgress.remainingCents,
      average,
      input.today,
      input.anchorDay,
      input.currentPeriodHasInflow,
    ),
  };
}

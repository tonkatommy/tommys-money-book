// The budget arithmetic: safe to spend, pace, projection.
//
// Ported from the design prototype's `totals()`, in integer cents, and kept
// pure so the interesting numbers can be tested without a database.
//
// The central idea is the split between FIXED and FLEXIBLE. A mortgage
// payment and a grocery shop are both money out, but only one of them is a
// decision you make today. Pacing a mortgage evenly across a month produces a
// number that means nothing, and including unpaid bills in "safe to spend"
// produces a number that is actively dangerous — it tells you to spend money
// that is already owed. So fixed categories are subtracted whole from the
// balance, and only flexible ones are paced.

import type { PayPeriod } from "./period";

/** One category's budget and what has actually happened to it. */
export type BudgetLine = {
  categoryId: string;
  name: string;
  /** The standing budget plus any carried-over difference. */
  budgetCents: number;
  /** Positive: money out. Expenses are stored negative and flipped on read. */
  spentCents: number;
  isFixed: boolean;
  /** Fixed bills only: has it landed this period? */
  paid: boolean;
};

export type BudgetTotals = {
  /** Everything, fixed and flexible. */
  budgetCents: number;
  spentCents: number;
  remainingCents: number;

  /** Everyday spending only — the part that can be paced. */
  flexBudgetCents: number;
  flexSpentCents: number;

  /** Bills budgeted for but not yet paid. */
  fixedRemainingCents: number;
  /** Flexible budget not yet spent, floored at zero per category. */
  untouchedCents: number;

  /** Where flexible spending should be by today. */
  expectedCents: number;
  /** expected − spent. Positive is under pace. */
  paceDeltaCents: number;

  /** Where the period lands at the current run rate. */
  projectedCents: number;
  /** budget − projected. Positive finishes under. */
  projectedDeltaCents: number;

  /** Balance, less unpaid bills, less untouched budgets. The headline. */
  safeCents: number;
  /** Safe to spend, per remaining day. */
  perDayCents: number;

  /** Where we are through the period, as a percentage. Drives the marker. */
  markerPct: number;
};

/**
 * Roll a set of budget lines into the figures the overview shows.
 *
 * `balanceCents` is the Akahu-reported balance for the book — real money in
 * real accounts, not a derived figure.
 */
export function budgetTotals(
  lines: BudgetLine[],
  balanceCents: number,
  period: PayPeriod,
): BudgetTotals {
  const flex = lines.filter((line) => !line.isFixed);
  const fixed = lines.filter((line) => line.isFixed);

  const budgetCents = sum(lines, (l) => l.budgetCents);
  const spentCents = sum(lines, (l) => l.spentCents);
  const flexBudgetCents = sum(flex, (l) => l.budgetCents);
  const flexSpentCents = sum(flex, (l) => l.spentCents);

  const fixedRemainingCents = sum(
    fixed.filter((l) => !l.paid),
    (l) => Math.max(0, l.budgetCents - l.spentCents),
  );

  // Floored per category, not in aggregate. Overspending on takeaways does
  // not free up grocery money — that budget is still committed — so an
  // overspend must not offset another category's underspend here.
  const untouchedCents = sum(flex, (l) => Math.max(0, l.budgetCents - l.spentCents));

  const expectedCents = Math.round(flexBudgetCents * period.elapsed);

  // Run-rate projection. Guarded because on day one of a period this divides
  // by the day count and a single early purchase would otherwise project to
  // an absurd figure — on day 1, "at this rate" is not yet a rate.
  const projectedFlexCents =
    period.dayOfPeriod > 1
      ? Math.round((flexSpentCents / period.dayOfPeriod) * period.daysInPeriod)
      : flexBudgetCents;

  // A fixed bill that has already landed contributes what it ACTUALLY cost,
  // not what it was budgeted. Using the budget for a paid bill makes the
  // projection understate exactly the overspends that hurt most: an estimated
  // bill budgeted at $967 that arrived at $2,899 would finish $1,932 over and
  // the projection would never say so. Unpaid bills still contribute their
  // budget, because that is the best available guess at what is coming.
  //
  // `paid` means "anything has landed", which is the same threshold
  // fixedRemainingCents uses to drop a bill from safe-to-spend — the feed
  // cannot tell a part payment from a full one, and the two figures agreeing
  // matters more than either guessing differently.
  const projectedCents =
    projectedFlexCents + sum(fixed, (l) => (l.paid ? l.spentCents : l.budgetCents));

  const safeCents = balanceCents - fixedRemainingCents - untouchedCents;

  // On the final day the remaining money is all available today, so divide by
  // at least one rather than by zero.
  const perDayCents = Math.round(safeCents / Math.max(1, period.daysLeft));

  return {
    budgetCents,
    spentCents,
    remainingCents: budgetCents - spentCents,
    flexBudgetCents,
    flexSpentCents,
    fixedRemainingCents,
    untouchedCents,
    expectedCents,
    paceDeltaCents: expectedCents - flexSpentCents,
    projectedCents,
    projectedDeltaCents: budgetCents - projectedCents,
    safeCents,
    perDayCents,
    markerPct: period.elapsed * 100,
  };
}

/**
 * What a category is allowed to spend: the standing budget plus any carryover.
 *
 * Floored at zero. A carried-over overspend larger than the budget would
 * otherwise produce a negative allowance, and a negative budget makes every
 * downstream percentage meaningless.
 */
export function allowanceCents(amountCents: number, carryoverCents: number): number {
  return Math.max(0, amountCents + carryoverCents);
}

/**
 * The three month-end options, as amounts.
 *
 * - keep:  the same standing budget again.
 * - carry: same budget, with the difference rolled into next period's
 *          allowance. The standing budget deliberately does not move — that's
 *          what stops one good month quietly becoming the new normal.
 * - match: set the budget to what was actually spent, rounded to the dollar.
 */
export function monthEndAmounts(
  budgetCents: number,
  spentCents: number,
): Record<"keep" | "carry" | "match", { amountCents: number; carryoverCents: number }> {
  const difference = budgetCents - spentCents;
  return {
    keep: { amountCents: budgetCents, carryoverCents: 0 },
    carry: { amountCents: budgetCents, carryoverCents: difference },
    match: { amountCents: roundToDollar(spentCents), carryoverCents: 0 },
  };
}

/** Round cents to a whole dollar — budgets are set in dollars, not cents. */
export function roundToDollar(cents: number): number {
  return Math.round(cents / 100) * 100;
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

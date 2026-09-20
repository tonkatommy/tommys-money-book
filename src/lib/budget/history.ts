// Budget vs actual across past pay periods — the pure half.
//
// Two jobs, and the first is the more important:
//
// 1. ONE DEFINITION OF A PERIOD'S ALLOWANCE. "Which budget row applies to
//    this period, and does its carryover count?" used to be answered inline,
//    twice, in `query.ts` (the overview and the month-end review). The history
//    screen asks the same question for six periods at once, and a third
//    hand-written copy is how the overview and the history end up quietly
//    disagreeing about what a month's budget was while every total on both
//    screens still balances. So `latestRows` and `allowanceFor` live here and
//    every read path goes through them. Phase 4b spec §3.
//
// 2. THE HISTORY ARITHMETIC. Variance, per-category summaries, period totals
//    and the adjustment hints — all over already-fetched rows, so every branch
//    with a money consequence is reachable from a unit test with no database.
//
// Two rules run through all of it:
//
//   - A period with no row is NO budget, not a zero budget (invariant 7). It
//     is `null` here, never `0`, and it is left out of every count and average.
//     Budgets only exist from mid-August 2026; counting the months before that
//     as "over" would make every category look chronically overspent purely
//     because the feature is new.
//
//   - Spent can be negative. A refund larger than a period's spending leaves a
//     category net negative, and invariant 2 keeps that visible rather than
//     clamping it. The arithmetic below handles it without a special case;
//     only the hint refuses to act on it (see `budgetHint`).

import type { PayPeriod } from "./period";
import { allowanceCents, roundToDollar } from "./totals";

/** The fields of a `CategoryBudget` row this module reads. */
export type BudgetRowLike = {
  categoryId: string;
  periodStart: Date;
  amountCents: number;
  carryoverCents: number;
};

/**
 * The budget row in force for each category during `period`.
 *
 * The most recent row with `periodStart <= period.start`, so a budget carries
 * on until someone changes it and no roll-forward job is needed (3b spec §3).
 *
 * Order-independent on purpose. The callers happen to sort by `periodStart`
 * descending today, and a first-wins loop over sorted rows would be shorter,
 * but it would also be correct only for as long as every caller remembers the
 * `orderBy` — and the history query reads one unsorted batch for six periods.
 */
export function latestRows<R extends BudgetRowLike>(
  rows: readonly R[],
  period: PayPeriod,
): Map<string, R> {
  const cutoff = period.start.getTime();
  const latest = new Map<string, R>();

  for (const row of rows) {
    const start = row.periodStart.getTime();
    if (start > cutoff) continue;

    const held = latest.get(row.categoryId);
    if (!held || start > held.periodStart.getTime()) {
      latest.set(row.categoryId, row);
    }
  }

  return latest;
}

export type Allowance = {
  /** The budget as set. */
  standingCents: number;
  /** Rolled in by a month-end "carry" — only in the period it was written for. */
  carryoverCents: number;
  /** What may be spent: standing plus carryover, floored at zero. */
  allowanceCents: number;
};

/**
 * What a category was allowed to spend in `period`, given its row in force.
 *
 * `null` for no row: no budget, which is not the same as a $0 budget.
 *
 * Carryover counts only when the row was written for THIS period. An
 * inherited row's carryover was a one-off correction for the period it was
 * written for; re-applying it every month afterwards would compound.
 */
export function allowanceFor(
  row: BudgetRowLike | null | undefined,
  period: PayPeriod,
): Allowance | null {
  if (!row) return null;

  const carryoverCents =
    row.periodStart.getTime() === period.start.getTime() ? row.carryoverCents : 0;

  return {
    standingCents: row.amountCents,
    carryoverCents,
    allowanceCents: allowanceCents(row.amountCents, carryoverCents),
  };
}

/** One category in one past period. */
export type PeriodCell = {
  period: PayPeriod;
  /** Null when no budget applied in this period. */
  allowance: Allowance | null;
  /** Positive cents spent. Negative when refunds outweighed spending. */
  spentCents: number;
};

/**
 * Allowance minus spent: positive is under, negative is over.
 *
 * `null` for a period with no budget. There is nothing to be over or under,
 * and showing the whole spend as an overspend is the invariant-7 mistake.
 */
export function varianceCents(cell: PeriodCell): number | null {
  if (!cell.allowance) return null;
  return cell.allowance.allowanceCents - cell.spentCents;
}

export type CategorySummary = {
  /** Periods in the window that had a budget. */
  budgetedCount: number;
  /** Budgeted periods spent above the allowance. */
  overCount: number;
  /** Budgeted periods spent below the allowance. */
  underCount: number;
  /**
   * Average spent over the BUDGETED periods only, rounded to the cent.
   *
   * Null when no period was budgeted. That is a real state — a category
   * budgeted for the first time this period — not a divide-by-zero to be
   * papered over with a NaN or a zero.
   */
  averageSpentCents: number | null;
};

/**
 * How a category tracked against its budget across the window.
 *
 * Over and under are judged against the ALLOWANCE here, because that is what
 * the table beside it shows and what was actually permitted that period. The
 * hint judges against the standing budget instead; `budgetHint` says why.
 * A period spent exactly to the cent is neither.
 */
export function summariseCategory(cells: readonly PeriodCell[]): CategorySummary {
  let budgetedCount = 0;
  let overCount = 0;
  let underCount = 0;
  let spentTotal = 0;

  for (const cell of cells) {
    const variance = varianceCents(cell);
    if (variance === null) continue;

    budgetedCount++;
    spentTotal += cell.spentCents;
    if (variance < 0) overCount++;
    else if (variance > 0) underCount++;
  }

  return {
    budgetedCount,
    overCount,
    underCount,
    averageSpentCents:
      budgetedCount === 0 ? null : Math.round(spentTotal / budgetedCount),
  };
}

/** The adjustment hint thresholds. Agreed 19/09/2026, 4b spec §8. */
export const HINT_MIN_PERIODS = 3;
export const HINT_MIN_MARGIN_CENTS = 2_000;
export const HINT_MIN_MARGIN_PERCENT = 10;

export type BudgetHint = {
  categoryId: string;
  direction: "over" | "under";
  /** The budget as it stands now — what the suggestion would replace. */
  standingCents: number;
  averageSpentCents: number;
  /** The average, rounded to the dollar like month-end's "match". */
  suggestedCents: number;
  /** Budgeted periods the average covers. */
  periods: number;
  /** Standing budget is $0, so there is no percentage to speak of. */
  zeroStanding: boolean;
  /** A fixed bill, so the wording says "bill" rather than "spending". */
  isFixed: boolean;
  /** The bill's amount was an estimate, so "the estimate is off". */
  estimated: boolean;
};

/**
 * Whether this category's budget and its spending have disagreed consistently
 * enough to be worth a look. Suggestions only; nothing here writes.
 *
 * All three must hold (4b spec §8):
 *
 * 1. At least three budgeted periods. Fewer is an anecdote.
 * 2. The last three budgeted periods all went the same way against the
 *    standing budget. A category that alternates is noisy, not wrong, and an
 *    average would hide that.
 * 3. The average spent is off from the CURRENT standing budget by at least
 *    10% and at least $20. Both, so a $5 category doesn't nag over $1 and a
 *    $2,000 one doesn't stay silent over $150.
 *
 * Judged against the STANDING budget, not the allowance. Carryover is a
 * one-off per period, and judging against it would make a category look over
 * or under because of last month's correction rather than its own budget.
 * And against the budget as it stands NOW, not as it stood in the window: if
 * the budget was already raised this period, the hint should stop suggesting
 * it.
 *
 * Refuses a negative average outright. Refunds outweighing spending over
 * three periods is a data story, not a budget — and a negative suggestion
 * would be floored to zero by `allowanceCents` anyway.
 */
export function budgetHint(input: {
  categoryId: string;
  cells: readonly PeriodCell[];
  /** The standing budget in the running period. Null if none. */
  currentStandingCents: number | null;
  isFixed: boolean;
  estimated: boolean;
}): BudgetHint | null {
  const { currentStandingCents: standing } = input;
  if (standing === null) return null;

  const budgeted = input.cells.filter((cell) => cell.allowance !== null);
  if (budgeted.length < HINT_MIN_PERIODS) return null;

  // `cells` run oldest first, so the last three budgeted are the most recent.
  const recent = budgeted.slice(-HINT_MIN_PERIODS);
  const allOver = recent.every(
    (cell) => cell.spentCents > (cell.allowance?.standingCents ?? 0),
  );
  const allUnder = recent.every(
    (cell) => cell.spentCents < (cell.allowance?.standingCents ?? 0),
  );
  if (!allOver && !allUnder) return null;

  const { averageSpentCents: average } = summariseCategory(input.cells);
  if (average === null || average < 0) return null;

  // The average has to point the same way as the recent run. Three recent
  // overs dragged back under the budget by an older, lower half of the window
  // is a budget that has only just started being wrong — not yet a pattern.
  const difference = average - standing;
  if (allOver && difference <= 0) return null;
  if (allUnder && difference >= 0) return null;

  const margin = Math.abs(difference);
  if (margin < HINT_MIN_MARGIN_CENTS) return null;

  // Integer arithmetic for the percentage: margin / standing >= 10%, without
  // dividing. A $0 standing budget has no percentage at all, so the $20 floor
  // above is the only test it faces rather than a division by zero.
  const zeroStanding = standing === 0;
  if (!zeroStanding && margin * 100 < standing * HINT_MIN_MARGIN_PERCENT) {
    return null;
  }

  return {
    categoryId: input.categoryId,
    direction: allOver ? "over" : "under",
    standingCents: standing,
    averageSpentCents: average,
    suggestedCents: roundToDollar(average),
    periods: budgeted.length,
    zeroStanding,
    isFixed: input.isFixed,
    estimated: input.estimated,
  };
}

export type PeriodTotal = {
  period: PayPeriod;
  /** Sum of allowances for categories budgeted this period. Null if none were. */
  allowanceCents: number | null;
  /** Spent in the categories that had a budget this period. */
  spentCents: number;
  /** Allowance minus spent. Null when nothing was budgeted. */
  varianceCents: number | null;
  /**
   * Spent in categories with no budget this period.
   *
   * Kept apart rather than dropped or merged. Dropped, the period's spending
   * silently shrinks; merged, the budget looks overspent by money nobody ever
   * budgeted for. Either way the comparison stops meaning anything, so it is
   * shown as its own figure.
   */
  unbudgetedSpentCents: number;
};

/** Whole-budget allowance vs spent for one period, across every category. */
export function periodTotal(
  period: PayPeriod,
  cells: readonly PeriodCell[],
): PeriodTotal {
  let allowance: number | null = null;
  let spentCents = 0;
  let unbudgetedSpentCents = 0;

  for (const cell of cells) {
    if (cell.allowance) {
      allowance = (allowance ?? 0) + cell.allowance.allowanceCents;
      spentCents += cell.spentCents;
    } else {
      unbudgetedSpentCents += cell.spentCents;
    }
  }

  return {
    period,
    allowanceCents: allowance,
    spentCents,
    varianceCents: allowance === null ? null : allowance - spentCents,
    unbudgetedSpentCents,
  };
}

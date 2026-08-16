// Finding the bills hiding in the transaction feed.
//
// The budget needs to know which categories are FIXED — the ones that arrive
// on a date whether you like it or not — because those are held out of the
// pace calculation and subtracted whole from "safe to spend" (see totals.ts).
// Asking Tommy to tag 63 categories by hand is how a setup screen gets
// abandoned halfway, so this suggests them from what has already happened.
//
// The grouping key is `normaliseDescription` from the categories module,
// reused rather than reinvented. That function already strips card numbers and
// per-transaction references, which is exactly the noise that makes one
// monthly insurance premium look like twelve unrelated payments — the same
// problem it was written to solve for rule matching.
//
// Suggestions only. Nothing here writes; the Setup screen shows what was found
// and Tommy confirms, because "this is a bill" is a claim about the future and
// the feed can only describe the past.

import { normaliseDescription } from "@/lib/categories/normalise";

export type RecurringInput = {
  categoryId: string;
  date: Date;
  description: string;
  /** Positive cents. Callers flip the stored negative before passing it. */
  amountCents: number;
};

export type RecurringSuggestion = {
  categoryId: string;
  /** The normalised description the run was found under. */
  key: string;
  /** Typical day of the month it lands on. */
  dueDay: number;
  /** The most recent amount — what next month is most likely to cost. */
  amountCents: number;
  /** Typical amount across the run, for the "varies" judgement. */
  typicalAmountCents: number;
  /** The amount moves month to month: power, water. Budget as an estimate. */
  estimated: boolean;
  occurrences: number;
};

/** Minimum hits before a pattern counts. Two points make a line, not a habit. */
const MIN_OCCURRENCES = 3;

/** A month, give or take. Covers 28-day Februarys and weekend drift. */
const MIN_GAP_DAYS = 24;
const MAX_GAP_DAYS = 38;

/** Above this much variation, the amount is an estimate rather than a figure. */
const ESTIMATE_THRESHOLD = 0.08;

const DAY_MS = 86_400_000;

/**
 * Suggest which categories look like recurring bills.
 *
 * At most one suggestion per category — the longest run wins, since a category
 * holding both a monthly premium and the odd one-off should be budgeted around
 * the premium.
 */
export function detectRecurring(
  transactions: RecurringInput[],
): RecurringSuggestion[] {
  // Keyed by category, then by normalised description. Nested maps rather than
  // one joined string key, because a normalised description contains spaces —
  // a joined key would have to be split back apart and would split in the
  // wrong place.
  const groups = new Map<string, Map<string, RecurringInput[]>>();

  for (const transaction of transactions) {
    if (transaction.amountCents <= 0) continue;

    let byDescription = groups.get(transaction.categoryId);
    if (!byDescription) {
      byDescription = new Map();
      groups.set(transaction.categoryId, byDescription);
    }

    const key = normaliseDescription(transaction.description);
    const group = byDescription.get(key);
    if (group) group.push(transaction);
    else byDescription.set(key, [transaction]);
  }

  const best = new Map<string, RecurringSuggestion>();

  for (const [categoryId, byDescription] of groups) {
    for (const [key, group] of byDescription) {
      const suggestion = assess(categoryId, key, group);
      if (!suggestion) continue;

      const existing = best.get(categoryId);
      if (!existing || suggestion.occurrences > existing.occurrences) {
        best.set(categoryId, suggestion);
      }
    }
  }

  return [...best.values()].sort((a, b) => b.amountCents - a.amountCents);
}

function assess(
  categoryId: string,
  key: string,
  group: RecurringInput[],
): RecurringSuggestion | null {
  if (group.length < MIN_OCCURRENCES) return null;

  const ordered = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Every gap must look monthly. Requiring all of them rather than an average
  // is what rejects a category that happens to have three purchases spread
  // across a quarter — the average gap would pass, the individual gaps won't.
  for (let i = 1; i < ordered.length; i++) {
    const gapDays =
      (ordered[i].date.getTime() - ordered[i - 1].date.getTime()) / DAY_MS;
    if (gapDays < MIN_GAP_DAYS || gapDays > MAX_GAP_DAYS) return null;
  }

  const amounts = ordered.map((transaction) => transaction.amountCents);
  const typicalAmountCents = median(amounts);
  if (typicalAmountCents <= 0) return null;

  const spread =
    (Math.max(...amounts) - Math.min(...amounts)) / typicalAmountCents;

  return {
    categoryId,
    key,
    dueDay: median(ordered.map((transaction) => transaction.date.getUTCDate())),
    amountCents: ordered[ordered.length - 1].amountCents,
    typicalAmountCents,
    estimated: spread > ESTIMATE_THRESHOLD,
    occurrences: ordered.length,
  };
}

/**
 * Median, not mean.
 *
 * One catch-up double payment or a missed month would drag a mean well away
 * from the figure that actually repeats, and the budget wants the repeating
 * one.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

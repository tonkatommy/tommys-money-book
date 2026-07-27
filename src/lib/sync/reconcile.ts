// Does what we stored still add up to what the bank says?
//
// The naive version of this check — "sum of stored transactions should equal
// the account balance" — cannot work, and understanding why is the whole
// design of this file.
//
// Akahu reaches back about two years. The account has existed for longer. So
// on day one there is already a balance sitting in the account that no
// transaction we hold explains. Summing our transactions gives a number
// thousands of dollars away from the truth, and it stays wrong forever.
//
// The fix is to measure that gap once, at baseline, and call it the opening
// balance:
//
//     openingBalance = akahuBalance - sum(transactions we just imported)
//
// It is, precisely, "the balance as it stood immediately before our earliest
// transaction". From then on the check has real teeth:
//
//     expected = openingBalance + sum(every transaction we hold)
//     drift    = akahuBalance - expected
//
// Drift of zero means we have every transaction the bank does. Non-zero means
// we are missing some (or have some we shouldn't) — the exact failure the
// spreadsheet used to hide.
//
// Pure arithmetic, all in integer cents.

/** Derive the opening balance at baseline. */
export function deriveOpeningBalanceCents(
  akahuBalanceCents: number,
  importedTotalCents: number,
): number {
  return akahuBalanceCents - importedTotalCents;
}

/**
 * Decide whether to derive, keep, or re-derive an account's opening balance.
 *
 * The subtraction above is only valid at a moment when we hold the complete
 * history Akahu is willing to give. Getting that timing wrong is silent and
 * permanent, so the rules are spelled out here rather than inline:
 *
 *  1. **No transactions? Derive nothing.** Akahu's own docs note that a newly
 *     connected account can report no transactions yet — they take a few
 *     seconds to process. Deriving then gives `opening = the whole balance`,
 *     and every transaction that arrives afterwards looks like drift, forever.
 *     `null` honestly means "not reconcilable yet".
 *
 *  2. **History reached further back than last time? Re-derive.** If we
 *     previously derived from a partial history and older transactions have
 *     since arrived, the old figure was measured from the wrong starting point
 *     and is now definitionally stale.
 *
 *  3. **Otherwise keep what we have.** This is the normal case, and it's what
 *     preserves the check's teeth: re-deriving on every run would make drift
 *     cancel itself out and the reconciliation would always "pass".
 *
 * Rule 2 is what makes rule 3 safe. Because the anchor is the earliest
 * transaction date, a genuinely missing *recent* transaction still shows as
 * drift — only a change in how far back our history reaches resets the anchor.
 */
export function resolveOpeningBalanceCents(input: {
  /** What we already had stored, if anything. */
  storedOpeningBalanceCents: number | null;
  akahuBalanceCents: number | null;
  /** Sum of everything we now hold for this account. */
  storedTotalCents: number;
  /** Earliest transaction we now hold; null when we hold none. */
  earliestTransactionDate: Date | null;
  /** The earliest we held before this run, i.e. Account.historyStartDate. */
  previousHistoryStartDate: Date | null;
}): number | null {
  const {
    storedOpeningBalanceCents,
    akahuBalanceCents,
    storedTotalCents,
    earliestTransactionDate,
    previousHistoryStartDate,
  } = input;

  // Rule 1. Nothing to measure from, and no balance to measure against.
  if (earliestTransactionDate === null || akahuBalanceCents === null) {
    return storedOpeningBalanceCents;
  }

  // Rule 2. Our history now starts earlier than the last time we derived.
  const historyReachesFurtherBack =
    previousHistoryStartDate !== null &&
    earliestTransactionDate.getTime() < previousHistoryStartDate.getTime();

  // Note `=== null`, not a falsy check: an opening balance of exactly 0 is a
  // real value (a brand new account), not a missing one.
  const neverDerived = storedOpeningBalanceCents === null;

  if (neverDerived || historyReachesFurtherBack) {
    return deriveOpeningBalanceCents(akahuBalanceCents, storedTotalCents);
  }

  // Rule 3.
  return storedOpeningBalanceCents;
}

export type Reconciliation = {
  /** openingBalance + sum of stored transactions. */
  computedBalanceCents: number;
  /** akahuBalance - computed. Zero is healthy. */
  driftCents: number;
  /** Convenience flag for the status page. */
  inBalance: boolean;
};

/**
 * Compare Akahu's reported balance against what our stored transactions imply.
 *
 * Returns null when we can't make a meaningful comparison — no balance from
 * Akahu, or no opening balance derived yet (an account that has never had a
 * baseline pull). Returning null rather than a fake zero keeps "not checked"
 * distinguishable from "checked and fine" on the status page.
 */
export function reconcileAccount(input: {
  akahuBalanceCents: number | null;
  openingBalanceCents: number | null;
  storedTotalCents: number;
}): Reconciliation | null {
  const { akahuBalanceCents, openingBalanceCents, storedTotalCents } = input;

  if (akahuBalanceCents === null || openingBalanceCents === null) {
    return null;
  }

  const computedBalanceCents = openingBalanceCents + storedTotalCents;
  const driftCents = akahuBalanceCents - computedBalanceCents;

  return {
    computedBalanceCents,
    driftCents,
    inBalance: driftCents === 0,
  };
}

/**
 * Should a drift be surfaced as a warning?
 *
 * Deliberately a warning and never an error. We import only *settled*
 * transactions, but Akahu reports the *current* balance — so on any day where
 * a payment has hit the balance but hasn't settled yet, a perfectly healthy
 * account shows drift. Failing the sync over that would train you to ignore
 * sync failures, which is worse than the problem.
 *
 * The real signal is drift that persists across runs, which is why every run
 * stores its own drift in AccountSyncResult rather than overwriting a single
 * value on Account. A one-off blip clears itself; a genuine missing
 * transaction shows the same number every morning.
 */
export function isDriftWorthWarningAbout(
  reconciliation: Reconciliation | null,
): boolean {
  return reconciliation !== null && reconciliation.driftCents !== 0;
}

/**
 * How long drift has to stick around before it means something.
 *
 * Long enough to outlive a settling payment, short enough that a genuinely
 * missing transaction surfaces the next morning rather than next week. One
 * daily sync cycle.
 */
export const PERSISTENT_DRIFT_HOURS = 24;

export type DriftObservation = {
  driftCents: number | null;
  observedAt: Date;
};

/**
 * Has drift lasted long enough to be a real gap rather than a settling payment?
 *
 * The obvious implementation — "non-zero on the last two runs" — is wrong, and
 * it produced a false alarm on real data within a day of being written. Two
 * manually triggered syncs 45 minutes apart both saw the same drift, so the
 * page announced it had "persisted across runs" when all it had really shown
 * was that nothing settles in 45 minutes. Counting runs only means "two days"
 * if runs happen daily, and the whole point of having a manual CLI is that
 * they don't.
 *
 * So measure elapsed time instead. Drift is persistent when the most recent
 * observation is non-zero and there's an unbroken stretch of non-zero drift
 * reaching back at least {@link PERSISTENT_DRIFT_HOURS} — however many runs
 * that took. A single zero anywhere in between resets the clock, because that
 * means the books did balance and whatever we're seeing now is new.
 */
export function isDriftPersistent(
  history: readonly DriftObservation[],
  minimumHours: number = PERSISTENT_DRIFT_HOURS,
): boolean {
  // Newest first. Callers pass whatever order the database gave them.
  const observed = history
    .filter(
      (entry): entry is DriftObservation & { driftCents: number } =>
        entry.driftCents !== null,
    )
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());

  const newest = observed[0];
  if (!newest || newest.driftCents === 0) return false;

  // Walk back through the unbroken stretch of non-zero drift.
  let oldestInStretch = newest;
  for (const entry of observed.slice(1)) {
    if (entry.driftCents === 0) break;
    oldestInStretch = entry;
  }

  const spanMs =
    newest.observedAt.getTime() - oldestInStretch.observedAt.getTime();

  return spanMs >= minimumHours * 3_600_000;
}

/** Sum transaction amounts. Trivial, but named so call sites read clearly. */
export function sumCents(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}

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

/** Sum transaction amounts. Trivial, but named so call sites read clearly. */
export function sumCents(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}

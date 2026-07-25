// Deciding which date range to ask Akahu for.
//
// Pure functions — no database, no network — because this is the single most
// likely place for the sync to lose data quietly, and quiet data loss is
// exactly what you want covered by fast tests.

import type { TransactionWindow } from "@/lib/akahu";

/**
 * How far back an incremental sync re-reads.
 *
 * THE POINT OF THIS WHOLE FILE: an incremental sync must anchor on the latest
 * transaction *date* we hold, minus a lookback, NOT on when the last sync ran.
 *
 * Banks post transactions late. A card payment made on Monday can appear in
 * the feed on Wednesday, still dated Monday. If Tuesday's sync asked for
 * "everything since Tuesday", Monday's transaction would never be requested
 * again by any future run — it would be missing forever, and the only symptom
 * would be a balance that's slightly wrong.
 *
 * So we deliberately re-request a week of already-seen transactions on every
 * run. That costs nothing: the unique constraint on externalId means re-fetched
 * rows are discarded by the database, and the `duplicates` count in the sync
 * log is the visible proof dedupe is doing its job.
 *
 * Seven days comfortably covers normal bank posting delays. Raise it via
 * SYNC_LOOKBACK_DAYS if a bank turns out to be slower.
 */
export const DEFAULT_LOOKBACK_DAYS = 7;

/**
 * How far back the baseline pull reaches.
 *
 * Under the Customer and Product Data Act the banks hold up to two years, but
 * how much Akahu actually returns varies, so we ask for far more than we
 * expect and let Akahu give us what it has. The alternative matters: omitting
 * `start` entirely makes Akahu default to the last 30 days, which would look
 * like a successful baseline and silently give us a month of history.
 */
export const BASELINE_LOOKBACK_YEARS = 10;

export function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/** The window for a full-history baseline pull. */
export function baselineWindow(now: Date = new Date()): TransactionWindow {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - BASELINE_LOOKBACK_YEARS);
  return { start, end: now };
}

/**
 * The window for an incremental sync of one account.
 *
 * `lastTransactionAt` is the latest transaction date we already hold for this
 * account, or null if we've never synced it (in which case we fall back to a
 * baseline-width window — a brand new account should get its full history, not
 * the last week).
 */
export function incrementalWindow(
  lastTransactionAt: Date | null,
  options: { now?: Date; lookbackDays?: number } = {},
): TransactionWindow {
  const now = options.now ?? new Date();
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  if (!lastTransactionAt) {
    return baselineWindow(now);
  }

  const start = new Date(lastTransactionAt.getTime() - daysToMs(lookbackDays));

  // Guard against a clock skew or a bad stored date putting `start` in the
  // future, which would ask Akahu for an empty (or invalid) range.
  if (start.getTime() > now.getTime()) {
    return { start: new Date(now.getTime() - daysToMs(lookbackDays)), end: now };
  }

  return { start, end: now };
}

/** Read SYNC_LOOKBACK_DAYS, ignoring nonsense rather than crashing the worker. */
export function lookbackDaysFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SYNC_LOOKBACK_DAYS;
  if (!raw) return DEFAULT_LOOKBACK_DAYS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `[sync] Ignoring invalid SYNC_LOOKBACK_DAYS="${raw}", ` +
        `using ${DEFAULT_LOOKBACK_DAYS}.`,
    );
    return DEFAULT_LOOKBACK_DAYS;
  }
  return parsed;
}

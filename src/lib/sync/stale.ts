// When a sync counts as overdue.
//
// Split out of `status.ts` so the worker can ask the same question the status
// page asks without importing Prisma to do it. There must be exactly one
// definition of "stale": a worker that decides to catch up on a different
// threshold than the page warns on is a worker that either syncs while the
// page says it is fine, or sits idle underneath a red banner. Both read as a
// bug in whichever half you are looking at.
//
// Pure, so it is unit-tested. The failure being guarded is the one this whole
// file exists for: a sync that has quietly stopped looks exactly like a sync
// with nothing to do.

/**
 * How long without a successful sync before we call it stale.
 *
 * The worker runs daily, so 36 hours means one missed morning triggers the
 * warning while a normal overnight gap never does.
 */
export const STALE_AFTER_HOURS = 36;

/** Whole hours between two instants. Negative if `since` is in the future. */
export function hoursSince(since: Date, now: Date): number {
  return (now.getTime() - since.getTime()) / 3_600_000;
}

/**
 * Is the feed overdue?
 *
 * `null` — no successful sync on record at all — is stale by definition. That
 * is the first-boot case and also the "every run so far has failed" case, and
 * both want the same answer: yes, go and sync.
 *
 * A `lastSuccess` in the future (a clock that jumped, a restored backup) reads
 * as not stale rather than as wildly stale. The conservative direction: a
 * missed catch-up costs a day, and the daily schedule fixes it, whereas
 * treating a bad clock as 40 years overdue would hammer Akahu on every boot.
 */
export function isSyncStale(
  lastSuccess: Date | null,
  now: Date = new Date(),
  thresholdHours: number = STALE_AFTER_HOURS,
): boolean {
  if (!lastSuccess) return true;
  return hoursSince(lastSuccess, now) > thresholdHours;
}

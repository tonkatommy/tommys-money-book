// The sync worker: a long-running container whose only job is to call
// runSync() every morning.
//
// Why a separate container rather than a timer inside the Next.js app:
//
//   - The app can be restarted, rebuilt, or crash-looping without the sync
//     schedule going with it (and vice versa).
//   - Next.js may run several server instances; a cron inside them would fire
//     several times, or none, depending on how they're scaled.
//   - `docker compose logs worker` is then a clean, complete sync history.
//
// Akahu personal apps have no webhooks, so polling is the only option. Once a
// day matches Akahu's own refresh cadence — polling more often just re-reads
// the same data.

import "dotenv/config";

import cron from "node-cron";

import { disconnectPrisma, prisma } from "@/lib/prisma";
import { runSync } from "@/lib/sync/run";
import { STALE_AFTER_HOURS, isSyncStale } from "@/lib/sync/stale";

// 7am. Akahu's overnight refresh has landed by then, and it's before the
// working day starts.
const DEFAULT_SCHEDULE = "0 7 * * *";

// The container's clock is UTC, but "every morning" means NZ morning — and NZ
// shifts by an hour twice a year for daylight saving. Pinning the timezone
// here means node-cron does that arithmetic; a bare UTC cron would silently
// drift to 8am for half the year.
const TIMEZONE = "Pacific/Auckland";

// A sync should take seconds. If one is somehow still running when the next
// fires, skipping is the right call: two concurrent runs would race on the
// same account rows for no benefit (dedupe makes the second run's work
// redundant anyway).
// Holds the promise for the sync currently in flight, or null. A promise
// rather than a boolean because shutdown needs to *wait* for it, not merely
// know it exists.
let inFlight: Promise<void> | null = null;

async function sync(): Promise<void> {
  if (inFlight) {
    console.warn("[worker] previous sync still running — skipping this tick");
    return;
  }

  inFlight = (async () => {
    try {
      await runSync({ prisma, mode: "incremental", trigger: "SCHEDULED" });
    } catch (err) {
      // Deliberately swallowed. runSync has already recorded the failure as a
      // FAILED SyncRun, which is what the status page reads. Rethrowing would
      // kill the worker and stop tomorrow's sync too — turning one bad morning
      // into an outage that lasts until someone notices.
      console.error(
        "[worker] sync failed, will retry on the next schedule:",
        err,
      );
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Sync now if the feed is overdue.
 *
 * `cron.schedule` fires only while the process is up. It has no concept of a
 * tick it missed: if the host is asleep at 7am, or the stack is down, or a
 * rebuild straddles the mark, that morning's sync does not happen and nothing
 * anywhere records that it didn't. There is no FAILED run to find, because
 * there was no run. The worker sits there logging its schedule and looking
 * perfectly healthy while the data quietly ages — which is the same failure
 * the status page's staleness banner exists to catch, arriving by a route the
 * worker itself could have prevented.
 *
 * That is not hypothetical: this app went 27 days on a single baseline,
 * through a worker that was up and correctly scheduled the whole time.
 *
 * The threshold is deliberately the status page's own (36 hours), so the
 * worker acts on exactly the condition the page warns about. A normal
 * overnight restart is nowhere near it, which is what keeps this off Akahu's
 * 1-hour rest limit — you would have to restart the container more than a day
 * after the last success to trigger a sync, and at that point a sync is the
 * correct thing to do.
 *
 * An `incremental` catch-up is enough however long the gap is, and this is
 * worth being precise about because the instinct is to reach for a baseline.
 * `incrementalWindow` anchors on the latest transaction date we *hold* minus a
 * lookback, never on when the last sync ran, so a 27-day gap simply produces a
 * 34-day window. There is no hole to leave.
 */
async function catchUp(): Promise<void> {
  try {
    const lastSuccess = await prisma.syncRun.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
    });

    if (!isSyncStale(lastSuccess?.startedAt ?? null, new Date())) {
      console.log("[worker] feed is current — no catch-up needed");
      return;
    }

    console.log(
      lastSuccess
        ? `[worker] last successful sync was ${lastSuccess.startedAt.toISOString()}, ` +
            `over ${STALE_AFTER_HOURS}h ago — catching up now`
        : "[worker] no successful sync on record — catching up now",
    );

    await sync();
  } catch (err) {
    // Same reasoning as the swallow in `sync`: a worker that dies on a bad
    // startup check is a worker that misses tomorrow's schedule too, which is
    // a worse outcome than a missed catch-up.
    console.error("[worker] catch-up check failed, schedule is unaffected:", err);
  }
}

function main(): void {
  const schedule = process.env.SYNC_CRON?.trim() || DEFAULT_SCHEDULE;

  if (!cron.validate(schedule)) {
    // Fail fast and loudly. A malformed schedule that we shrugged off would
    // mean a worker that sits there looking healthy and never syncs.
    console.error(
      `[worker] SYNC_CRON="${schedule}" is not a valid cron expression. ` +
        `Expected five fields, e.g. "0 7 * * *".`,
    );
    process.exit(1);
  }

  console.log(
    `[worker] scheduled "${schedule}" (${TIMEZONE}) — ` +
      `akahu mode ${process.env.AKAHU_MODE ?? "fixture"}`,
  );

  cron.schedule(schedule, () => void sync(), { timezone: TIMEZONE });

  // Compose sends SIGTERM on `docker compose down`, then SIGKILLs after a
  // grace period (10s by default). We drain: let the in-flight sync finish so
  // it can write its own terminal status, then close the pool and exit.
  //
  // Without the drain, shutting down mid-sync left a SyncRun stuck at RUNNING
  // forever — a row that reads as "a sync is happening right now" on the
  // status page and never resolves.
  //
  // The timeout matters as much as the wait. If a sync is genuinely wedged,
  // blocking until Docker SIGKILLs us produces the same orphaned RUNNING row
  // we're trying to avoid, only slower. So we give it a bounded window, then
  // go anyway.
  const SHUTDOWN_GRACE_MS = 8_000;
  let shuttingDown = false;

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      // A second Ctrl-C means "I meant it" — go immediately.
      if (shuttingDown) {
        console.log(`[worker] ${signal} again — exiting now`);
        process.exit(1);
      }
      shuttingDown = true;

      console.log(
        `[worker] ${signal} received, shutting down` +
          (inFlight ? " — waiting for the sync in flight" : ""),
      );

      void (async () => {
        if (inFlight) {
          const drained = await Promise.race([
            inFlight.then(() => true),
            new Promise<false>((resolve) =>
              setTimeout(() => resolve(false), SHUTDOWN_GRACE_MS),
            ),
          ]);

          if (!drained) {
            console.warn(
              `[worker] sync did not finish within ${SHUTDOWN_GRACE_MS}ms — ` +
                `exiting anyway. Its SyncRun will be left at RUNNING.`,
            );
          }
        }

        await disconnectPrisma();
        process.exit(0);
      })();
    });
  }

  // Last, deliberately: everything below can start a sync, and a sync that
  // began before the handlers above were registered could not be drained on
  // shutdown — leaving the orphaned RUNNING row they exist to prevent.

  // Sync once at startup regardless of how fresh the feed is. Off by default,
  // because restarting the container shouldn't hammer Akahu (personal apps
  // enforce a 1-hour rest between manual refreshes), but it's invaluable when
  // verifying the container actually works without waiting until 7am.
  if (process.env.SYNC_ON_START === "true") {
    console.log("[worker] SYNC_ON_START=true — running one sync now");
    void sync();
    return;
  }

  // Otherwise catch up only if the feed is actually overdue. See `catchUp`.
  if (process.env.SYNC_CATCHUP === "false") {
    console.log("[worker] SYNC_CATCHUP=false — not checking for a missed sync");
    return;
  }

  void catchUp();
}

main();

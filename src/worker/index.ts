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

  // Optional: sync once at startup. Off by default, because restarting the
  // container shouldn't hammer Akahu (personal apps enforce a 1-hour rest
  // between manual refreshes), but it's invaluable when verifying the
  // container actually works without waiting until 7am.
  if (process.env.SYNC_ON_START === "true") {
    console.log("[worker] SYNC_ON_START=true — running one sync now");
    void sync();
  }

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
}

main();

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

import { prisma } from "@/lib/prisma";
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
let running = false;

async function sync(): Promise<void> {
  if (running) {
    console.warn("[worker] previous sync still running — skipping this tick");
    return;
  }

  running = true;
  try {
    await runSync({ prisma, mode: "incremental", trigger: "SCHEDULED" });
  } catch (err) {
    // Deliberately swallowed. runSync has already recorded the failure as a
    // FAILED SyncRun, which is what the status page reads. Rethrowing would
    // kill the worker and stop tomorrow's sync too — turning one bad morning
    // into an outage that lasts until someone notices.
    console.error("[worker] sync failed, will retry on the next schedule:", err);
  } finally {
    running = false;
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

  // Compose sends SIGTERM on `docker compose down`. Finishing the current run
  // and closing the connection pool cleanly avoids leaving a SyncRun stuck in
  // RUNNING, which the status page would show as a sync in progress forever.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.log(`[worker] ${signal} received, shutting down`);
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  }
}

main();

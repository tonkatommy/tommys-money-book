// A single incremental sync. `npm run sync:daily`
//
// This is exactly what the cron worker calls — running it by hand and running
// it on a schedule exercise the same code path, so there's no "works
// manually, fails in the container" gap to debug at 7am.

import { runScript } from "./_run";
import { prisma } from "@/lib/prisma";
import { runSync } from "@/lib/sync/run";

void runScript("sync", async () => {
  const summary = await runSync({
    prisma,
    mode: "incremental",
    // MANUAL, because a human typed this. The worker passes SCHEDULED, which
    // is how the status page can tell "Tommy poked it" from "the cron ran".
    trigger: "MANUAL",
  });

  if (summary.status !== "SUCCESS") {
    // Non-zero exit so the shell, and anything wrapping it, sees the failure.
    throw new Error(
      `Sync finished ${summary.status} — ${summary.accountsFailed} account(s) failed. ` +
        `See the log above and the status page.`,
    );
  }
});

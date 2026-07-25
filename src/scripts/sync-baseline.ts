// The one-off full-history pull. `npm run sync:baseline`
//
// Run this once per account, when Akahu is first connected. It asks for
// everything Akahu will give (see BASELINE_LOOKBACK_YEARS), derives each
// account's opening balance, and records how far back each bank reaches.
//
// Safe to re-run: dedupe means a second baseline imports nothing and simply
// re-reports the numbers. That's a feature — it's the cheapest possible proof
// that dedupe works.

import { runScript } from "./_run";
import { prisma } from "@/lib/prisma";
import { runSync } from "@/lib/sync/run";
import { storedHistoryDepth } from "@/lib/sync/history-probe";

void runScript("baseline", async () => {
  const summary = await runSync({
    prisma,
    mode: "baseline",
    trigger: "BASELINE",
  });

  console.log("");
  console.log("History depth per account (this is the app's day zero):");
  console.log("");

  for (const depth of await storedHistoryDepth(prisma)) {
    if (depth.transactionCount === 0) {
      console.log(`  ${depth.accountName}: no transactions`);
      continue;
    }

    console.log(
      `  ${depth.accountName}: ${depth.transactionCount} transactions, ` +
        `from ${depth.earliest?.toISOString().slice(0, 10)} ` +
        `to ${depth.latest?.toISOString().slice(0, 10)} ` +
        `(~${depth.monthsOfHistory} months)`,
    );

    // The practical consequence, spelled out rather than left as arithmetic:
    // FY2027 runs 01/04/2026–31/03/2027, and it's the first year-end this app
    // could produce on its own.
    console.log(
      depth.coversFy2027
        ? `    reaches back past 01/04/2026 — FY2027 is fully covered by the app`
        : `    does NOT reach 01/04/2026 — FY2027 will need the Excel archive too`,
    );
  }

  console.log("");
  console.log(
    `Baseline ${summary.status}: ${summary.totals.inserted} imported, ` +
      `${summary.totals.duplicates} already held.`,
  );
  console.log(
    "Next: `npm run accounts:map` to assign each account to a set of books.",
  );
});

// Read-only reconnaissance. `npm run akahu:probe`
//
// Writes nothing. This is the first thing to run when real tokens arrive:
// it proves the tokens work, shows which accounts Akahu can see, and answers
// the plan's open question about how far back each bank's history reaches —
// all before committing anything to the database.
//
// If the history turns out shallower than hoped, far better to learn it from
// a report than from a database you now have to empty and redo.

import { runScript } from "./_run";
import { createGateway } from "@/lib/akahu";
import { formatNZD } from "@/lib/money";
import { probeHistory } from "@/lib/sync/history-probe";

void runScript("probe", async () => {
  const gateway = createGateway();

  console.log("");
  console.log(`Accounts visible to this Akahu token (${gateway.mode} mode):`);
  console.log("");

  for (const account of await gateway.listAccounts()) {
    const balance =
      account.balanceCents !== null ? formatNZD(account.balanceCents) : "—";

    console.log(`  ${account.connectionName ?? "?"} — ${account.akahuName}`);
    console.log(`    akahu id     ${account.akahuId}`);
    console.log(`    type         ${account.accountType}`);
    console.log(`    status       ${account.status}`);
    console.log(`    balance      ${balance}`);
    console.log(
      `    transactions ${account.supportsTransactions ? "yes" : "no feed"}`,
    );
  }

  console.log("");
  console.log("History depth (what a baseline pull would import):");
  console.log("");

  for (const depth of await probeHistory(gateway)) {
    if (!depth.supportsTransactions) {
      console.log(`  ${depth.accountName}: no transaction feed — will be skipped`);
      continue;
    }

    console.log(
      `  ${depth.accountName}: ${depth.transactionCount} transactions, ` +
        `earliest ${depth.earliest?.toISOString().slice(0, 10) ?? "none"} ` +
        `(~${depth.monthsOfHistory ?? 0} months)`,
    );
    console.log(
      depth.coversFy2027
        ? `    covers FY2027 (from 01/04/2026)`
        : `    does not reach 01/04/2026 — Excel archive still needed for FY2027`,
    );
  }

  console.log("");
  console.log("Nothing was written. Run `npm run sync:baseline` to import.");
});

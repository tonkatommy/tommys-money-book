// Create the accounts manual entries hang off. `npm run accounts:seed-cash`
//
// Idempotent — run it as often as you like. Needed once before
// `/transactions/new` can save anything; the app also calls the same function
// on startup so a fresh clone doesn't have to know about this script.

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { CASH_ACCOUNT_NAMES, seedCashAccounts } from "@/lib/accounts/cash";

void runScript("accounts:seed-cash", async () => {
  const args = parseArgs(process.argv.slice(2));
  args.rejectUnknown();

  const { created, existing } = await seedCashAccounts(prisma);

  console.log("");
  console.log(`Cash accounts: ${created} created, ${existing} already there.`);
  console.log("");

  for (const book of ["PERSONAL", "BUSINESS"] as const) {
    const name = CASH_ACCOUNT_NAMES[book];
    const count = await prisma.transaction.count({
      where: { account: { name } },
    });
    console.log(`  ${name.padEnd(18)} ${count} manual transaction(s)`);
  }

  console.log("");
  console.log(
    "No akahuId, so sync, reconciliation and the balance refresh all skip them.",
  );
});

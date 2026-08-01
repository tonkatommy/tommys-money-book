// Run the rules over stored transactions. `npm run categories:apply`
//
// Dry by default. Nothing is written until you pass --confirm, because this
// touches every uncategorised row in a database of real financial data and
// "I meant to look first" is not a recoverable position.
//
//   npm run categories:apply                  # show what would happen
//   npm run categories:apply -- --confirm     # do it
//   npm run categories:apply -- --all --confirm
//   npm run categories:apply -- --force --confirm   # also re-do MANUAL rows

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { applyRules } from "@/lib/categories/apply";

void runScript("categories:apply", async () => {
  const args = parseArgs(process.argv.slice(2));
  const confirm = args.flag("confirm");
  const all = args.flag("all");
  const force = args.flag("force");
  args.rejectUnknown();

  if (force && !all) {
    // --force means "overwrite human decisions", which only makes sense
    // against rows that already have one. Silently doing nothing would be a
    // worse answer than saying so.
    console.log(
      "--force overwrites rows a human categorised, so it needs --all too " +
        "(the default scope only looks at uncategorised rows).",
    );
    return;
  }

  const result = await applyRules(prisma, {
    scope: all ? "all" : "uncategorised",
    force,
    dryRun: !confirm,
  });

  console.log("");
  console.log(confirm ? "APPLIED" : "DRY RUN — nothing written");
  console.log("");
  console.log(`  considered      ${result.considered}`);
  console.log(`  matched a rule  ${result.matched}`);
  console.log(`  would change    ${result.changed}`);
  console.log(`  left for review ${result.unmatched}`);
  if (result.skippedManual > 0) {
    console.log(
      `  skipped         ${result.skippedManual} (categorised by hand or by a transfer pair)`,
    );
  }

  if (result.tallies.length > 0) {
    console.log("");
    console.log("  Where they land:");
    console.log("");
    for (const tally of result.tallies) {
      console.log(
        `    ${tally.book.slice(0, 4).padEnd(4)} ${String(tally.count).padStart(4)}  ` +
          `${formatNZD(tally.netCents).padStart(14)}  ${tally.name}`,
      );
    }
  }

  console.log("");
  if (!confirm) {
    console.log("Re-run with --confirm to write. Then: npm run categories:review");
    return;
  }

  if (result.unmatched > 0) {
    console.log(
      `${result.unmatched} transactions matched no rule. ` +
        `Next: npm run categories:review`,
    );
  }
});

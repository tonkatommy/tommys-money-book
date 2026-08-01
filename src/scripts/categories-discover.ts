// What does the money actually do? `npm run categories:discover`
//
// Read-only. Writes nothing, changes nothing — safe to run any time, and the
// starting point whenever the category list needs reshaping.
//
//   npm run categories:discover
//   npm run categories:discover -- --keys 60      # show more of the tail

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { buildDiscoveryReport, type RankedGroup } from "@/lib/categories/discover";

void runScript("discover", async () => {
  const args = parseArgs(process.argv.slice(2));
  const keyLimit = Number(args.value("keys") ?? 40);
  const bookFilter = args.value("book")?.toUpperCase();
  args.rejectUnknown();

  const report = await buildDiscoveryReport(prisma);

  if (report.coverage.every((row) => row.transactions === 0)) {
    console.log("No transactions yet — run `npm run sync:baseline` first.");
    return;
  }

  const date = (value: Date | null): string =>
    value ? value.toISOString().slice(0, 10) : "—";

  console.log("");
  console.log(
    `Baseline: ${date(report.earliest)} → ${date(report.latest)}`,
  );
  console.log("");

  // --- 1. How much of this can Akahu categorise for us? ---------------------
  console.log("ENRICHMENT COVERAGE");
  console.log("");
  console.log(
    "  book       txns   akahu cat    merchant     neither   categorised",
  );
  for (const row of report.coverage) {
    const label = (row.book ?? "TOTAL").padEnd(9);
    const pct = (n: number): string =>
      row.transactions === 0
        ? "—"
        : `${((n / row.transactions) * 100).toFixed(0)}%`;

    console.log(
      `  ${label} ${String(row.transactions).padStart(6)}` +
        `   ${String(row.withAkahuCategory).padStart(5)} ${pct(row.withAkahuCategory).padStart(4)}` +
        `   ${String(row.withMerchant).padStart(5)} ${pct(row.withMerchant).padStart(4)}` +
        `   ${String(row.withNeither).padStart(7)}` +
        `   ${String(row.categorised).padStart(11)}`,
    );
  }

  // The finding that reshaped Phase 2 — worth restating every run, because
  // it's the reason the rule set looks the way it does.
  const enrichedIncome = report.akahuCategories.filter(
    (group) => group.inCents > 0,
  ).length;
  console.log("");
  console.log(
    `  Akahu categories carrying any income: ${enrichedIncome} of ` +
      `${report.akahuCategories.length}. Enrichment fires on card spending ` +
      `only, so income categorisation must come from descriptions.`,
  );

  // --- 2. The tail, and how much work it really is -------------------------
  const cov = report.keyCoverage;
  console.log("");
  console.log("UN-ENRICHED DESCRIPTIONS, NORMALISED");
  console.log("");
  console.log(
    `  ${cov.transactions} transactions collapse to ${cov.distinctKeys} distinct keys`,
  );
  const share = (n: number): string =>
    cov.transactions === 0 ? "—" : `${((n / cov.transactions) * 100).toFixed(0)}%`;
  console.log(`    top 10 keys cover ${String(cov.top10).padStart(5)}  ${share(cov.top10)}`);
  console.log(`    top 25 keys cover ${String(cov.top25).padStart(5)}  ${share(cov.top25)}`);
  console.log(`    top 50 keys cover ${String(cov.top50).padStart(5)}  ${share(cov.top50)}`);
  console.log(`    top 100 keys cover ${String(cov.top100).padStart(4)}  ${share(cov.top100)}`);

  const filtered = (groups: RankedGroup[]): RankedGroup[] =>
    bookFilter ? groups.filter((g) => g.book === bookFilter) : groups;

  printRanked(
    "TOP UN-ENRICHED KEYS",
    filtered(report.unenrichedKeys).slice(0, keyLimit),
  );
  printRanked(
    "AKAHU SUGGESTED CATEGORIES",
    filtered(report.akahuCategories).slice(0, keyLimit),
  );
  printRanked("MERCHANTS", filtered(report.merchants).slice(0, keyLimit));
  printRanked("TRANSACTION TYPES", filtered(report.akahuTypes));

  console.log("");
  console.log(
    "Keys above are exactly what `categories:review` groups by and what a " +
      "DESCRIPTION rule in definitions.ts matches on — paste one straight in.",
  );
});

function printRanked(title: string, groups: readonly RankedGroup[]): void {
  console.log("");
  console.log(title);
  console.log("");

  if (groups.length === 0) {
    console.log("  (none)");
    return;
  }

  for (const group of groups) {
    const book = (group.book ?? "—").slice(0, 4).padEnd(4);
    const count = String(group.count).padStart(4);
    const money =
      group.inCents !== 0 && group.outCents !== 0
        ? `${formatNZD(group.inCents)} in / ${formatNZD(group.outCents)} out`
        : formatNZD(group.inCents + group.outCents);

    console.log(`  ${book} ${count}  ${money.padEnd(28)} ${group.label}`);
    if (group.detail) console.log(`                                          ↳ ${group.detail}`);
  }
}

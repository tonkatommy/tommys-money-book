// What the rules couldn't decide. `npm run categories:review`
//
// Read-only. Groups uncategorised transactions by the same normalised key the
// matcher uses, so one line here is one decision — and the key it prints can
// be pasted straight into a rule or into `categories:recat --match`.
//
//   npm run categories:review
//   npm run categories:review -- --book BUSINESS
//   npm run categories:review -- --min 2 --limit 60

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { reviewQueue, reviewSummary } from "@/lib/categories/review";
import type { Book } from "@/generated/prisma/client";

void runScript("categories:review", async () => {
  const args = parseArgs(process.argv.slice(2));
  const bookArg = args.value("book")?.toUpperCase();
  const minCount = Number(args.value("min") ?? 1);
  const limit = Number(args.value("limit") ?? 40);
  args.rejectUnknown();

  if (bookArg && bookArg !== "PERSONAL" && bookArg !== "BUSINESS") {
    throw new Error(`--book expects PERSONAL or BUSINESS, got "${bookArg}"`);
  }

  const groups = await reviewQueue(prisma, {
    book: bookArg as Book | undefined,
    minCount,
  });
  const summary = await reviewSummary(prisma, groups);

  console.log("");
  if (summary.uncategorised === 0) {
    console.log(`Nothing to review — all ${summary.total} transactions have a category.`);
    return;
  }

  console.log(
    `${summary.uncategorised} of ${summary.total} transactions uncategorised, ` +
      `in ${summary.distinctKeys} distinct keys.`,
  );
  console.log(
    `  ${summary.keysFor80} keys clear 80%  ·  ${summary.keysFor90} clear 90%  ` +
      `·  ${summary.keysFor95} clear 95%`,
  );
  console.log("");
  console.log("  book  txns          value  dates              key");
  console.log("");

  const date = (value: Date): string => value.toISOString().slice(0, 10);

  for (const group of groups.slice(0, limit)) {
    const book = (group.book ?? "MIX").slice(0, 4).padEnd(4);
    const direction = group.direction === "MIXED" ? "±" : " ";

    console.log(
      `  ${book} ${String(group.count).padStart(5)}${direction} ` +
        `${formatNZD(group.netCents).padStart(13)}  ` +
        `${date(group.firstDate)}→${date(group.lastDate)}  ${group.key}`,
    );
  }

  if (groups.length > limit) {
    console.log("");
    console.log(`  … and ${groups.length - limit} more (--limit to see them)`);
  }

  console.log("");
  console.log("To resolve a key, either:");
  console.log(
    '  add a rule to src/lib/categories/definitions.ts, then ' +
      "`npm run categories:seed && npm run categories:apply -- --confirm`",
  );
  console.log(
    '  or move them once: npm run categories:recat -- --match "<key>" --to "<category>"',
  );
});

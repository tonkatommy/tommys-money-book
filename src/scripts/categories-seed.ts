// Push the category list into the database. `npm run categories:seed`
//
// Idempotent — run it as often as you like. definitions.ts is the source of
// truth; this makes the database agree with it.
//
//   npm run categories:seed
//   npm run categories:seed -- --verify    # also report rules matching nothing

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { seedCategories } from "@/lib/categories/seed";
import { ruleCoverage } from "@/lib/categories/apply";

void runScript("categories:seed", async () => {
  const args = parseArgs(process.argv.slice(2));
  const verify = args.flag("verify");
  args.rejectUnknown();

  const result = await seedCategories(prisma);

  console.log("");
  console.log(
    `Categories: ${result.categoriesCreated} created, ` +
      `${result.categoriesUpdated} updated.`,
  );
  console.log(`Rules: ${result.rulesWritten} written.`);

  if (result.orphanedRemoved.length > 0) {
    console.log("");
    console.log("Removed (no longer defined, no transactions):");
    for (const name of result.orphanedRemoved) console.log(`  ${name}`);
  }

  if (result.orphanedInUse.length > 0) {
    console.log("");
    console.log(
      "STILL IN USE but no longer in definitions.ts — left alone. Either " +
        "add them back, or move their transactions first:",
    );
    for (const orphan of result.orphanedInUse) {
      console.log(
        `  ${orphan.name} (${orphan.book}) — ${orphan.transactions} transactions`,
      );
      console.log(
        `    npm run categories:recat -- --from "${orphan.name}" ` +
          `--book ${orphan.book} --to "<new category>"`,
      );
    }
  }

  if (!verify) {
    console.log("");
    console.log("Next: npm run categories:seed -- --verify");
    return;
  }

  const coverage = await ruleCoverage(prisma);
  const dead = coverage.filter((rule) => rule.matches === 0);

  console.log("");
  console.log(
    `Rule coverage: ${coverage.length - dead.length} of ${coverage.length} ` +
      `rules win at least one transaction.`,
  );

  if (dead.length === 0) {
    console.log("Every rule earns its place.");
    return;
  }

  // Three outcomes, and only one of them is a bug.
  const suspicious = dead.filter((rule) =>
    rule.shadowedBy.some((shadow) => !shadow.sameCategory),
  );
  const redundant = dead.filter(
    (rule) =>
      rule.shadowedBy.length > 0 &&
      rule.shadowedBy.every((shadow) => shadow.sameCategory),
  );
  const unused = dead.filter((rule) => rule.shadowedBy.length === 0);

  const describe = (rule: (typeof dead)[number]): string =>
    `  ${rule.book.slice(0, 4).padEnd(4)} ${rule.field.padEnd(15)} ` +
    `${rule.pattern.padEnd(38)} → ${rule.categoryName}`;

  if (suspicious.length > 0) {
    console.log("");
    console.log(
      "SHADOWED BY A DIFFERENT CATEGORY — look at these. One of the two " +
        "patterns is wrong, and transactions are landing somewhere nobody " +
        "chose:",
    );
    console.log("");
    for (const rule of suspicious) {
      console.log(describe(rule));
      for (const shadow of rule.shadowedBy.filter((s) => !s.sameCategory)) {
        console.log(
          `         beaten by "${shadow.pattern}" → ${shadow.categoryName}`,
        );
      }
    }
  }

  if (redundant.length > 0) {
    console.log("");
    console.log(
      "Redundant, but harmless — a more specific rule already sends these " +
        "to the same category. Worth keeping as a safety net if the bank " +
        "ever changes its description format:",
    );
    console.log("");
    for (const rule of redundant) console.log(describe(rule));
  }

  if (unused.length > 0) {
    console.log("");
    console.log(
      "Match nothing at all. Either a typo — a pattern written against the " +
        "raw description instead of the normalised one, or a merchant name " +
        "spelled differently from Akahu's — or a category that exists " +
        "because a report needs the line, not because the money has moved:",
    );
    console.log("");
    for (const rule of unused) console.log(describe(rule));
  }
});

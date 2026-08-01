// Move transactions in bulk. `npm run categories:recat`
//
// The first draft of a category list is wrong in places. This is what makes
// that cheap rather than something you live with.
//
//   npm run categories:recat -- --match "thomas brett" --direction IN \
//                               --to "Reimbursements & Shared Costs"
//   npm run categories:recat -- --from "Household & General Retail" \
//                               --to "Groceries" --book PERSONAL
//
// Always previews first. Add --confirm to write. Anything moved this way is
// marked MANUAL, so the matcher will never quietly undo it.

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { applyRecat, previewRecat, type RecatFilter } from "@/lib/categories/recat";
import type { Book } from "@/generated/prisma/client";

void runScript("categories:recat", async () => {
  const args = parseArgs(process.argv.slice(2));

  const to = args.value("to");
  const toBook = parseBook(args.value("to-book"));
  const confirm = args.flag("confirm");

  const filter: RecatFilter = {
    fromCategory: args.value("from"),
    matchKey: args.value("match"),
    uncategorisedOnly: args.flag("uncategorised"),
    book: parseBook(args.value("book")),
    accountName: args.value("account"),
    direction: parseDirection(args.value("direction")),
  };

  args.rejectUnknown();

  if (!to) {
    throw new Error(
      'Missing --to "<category name>". Run `npm run categories:review` to ' +
        "see what needs moving.",
    );
  }

  const preview = await previewRecat(prisma, filter);

  console.log("");
  console.log(`Selection: ${preview.count} transactions, ${formatNZD(preview.netCents)}`);

  if (preview.count === 0) {
    console.log("");
    console.log(
      "Nothing matched. Note --match takes a *normalised* key — the text " +
        "`categories:review` prints, not the raw bank description.",
    );
    return;
  }

  console.log("");
  for (const sample of preview.samples) {
    console.log(
      `  ${sample.date.toISOString().slice(0, 10)}  ` +
        `${formatNZD(sample.amountCents).padStart(12)}  ` +
        `${sample.account.padEnd(24)} ${sample.description}`,
    );
  }
  if (preview.count > preview.samples.length) {
    console.log(`  … and ${preview.count - preview.samples.length} more`);
  }

  console.log("");

  if (!confirm) {
    console.log(`Would move all ${preview.count} into "${to}".`);
    console.log("Re-run with --confirm to write.");
    return;
  }

  const result = await applyRecat(prisma, filter, to, toBook);

  console.log(
    `Moved ${result.moved} transactions into "${result.category}" ` +
      `(${result.book}), marked MANUAL.`,
  );
});

function parseBook(value: string | undefined): Book | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (upper === "PERSONAL" || upper === "BUSINESS") return upper;
  throw new Error(`Expected PERSONAL or BUSINESS, got "${value}"`);
}

function parseDirection(value: string | undefined): "IN" | "OUT" | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (upper === "IN" || upper === "OUT") return upper;
  throw new Error(`Expected IN or OUT, got "${value}"`);
}

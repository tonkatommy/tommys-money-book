// Confirm a suggested transfer pair. `npm run transfers:confirm`
//
//   npm run transfers:confirm -- --out <id> --in <id> --confirm
//   npm run transfers:confirm -- --confidence HIGH --confirm   # bulk
//
// Bulk confirmation deliberately refuses contested suggestions — where one
// outgoing leg has several plausible counterparts, picking for you is exactly
// the mistake this whole tier exists to avoid. Those are confirmed one at a
// time, by id, having looked at them.

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { detectTransfers, writePair } from "@/lib/transfers/run";

void runScript("transfers:confirm", async () => {
  const args = parseArgs(process.argv.slice(2));
  const outId = args.value("out");
  const inId = args.value("in");
  const confidence = args.value("confidence")?.toUpperCase();
  const confirm = args.flag("confirm");
  args.rejectUnknown();

  // --- Single pair by id ----------------------------------------------------
  if (outId || inId) {
    if (!outId || !inId) {
      throw new Error("Confirming one pair needs both --out <id> and --in <id>.");
    }

    if (!confirm) {
      console.log("");
      console.log(`Would pair ${outId} with ${inId}. Re-run with --confirm.`);
      return;
    }

    await writePair(prisma, outId, inId);
    console.log("");
    console.log("Paired. Both legs now share a transferPairId and net to zero.");
    return;
  }

  // --- Bulk by confidence ---------------------------------------------------
  if (!confidence) {
    throw new Error(
      "Give either --out <id> --in <id>, or --confidence HIGH to confirm " +
        "every uncontested suggestion at that level. " +
        "Run `npm run transfers:detect` first to see them.",
    );
  }

  if (!["HIGH", "MEDIUM", "LOW"].includes(confidence)) {
    throw new Error(`--confidence expects HIGH, MEDIUM or LOW, got "${confidence}"`);
  }

  const { suggestions } = await detectTransfers(prisma, { dryRun: true });

  const eligible = suggestions.filter(
    (suggestion) =>
      suggestion.confidence === confidence && !suggestion.contested,
  );
  const skipped = suggestions.filter(
    (suggestion) => suggestion.confidence === confidence && suggestion.contested,
  );

  console.log("");
  console.log(
    `${eligible.length} uncontested ${confidence} suggestions; ` +
      `${skipped.length} contested ones skipped.`,
  );
  console.log("");

  for (const suggestion of eligible) {
    console.log(
      `  ${suggestion.date.toISOString().slice(0, 10)}  ` +
        `${formatNZD(suggestion.amountCents).padStart(12)}  ` +
        `${suggestion.fromAccount} → ${suggestion.toAccount}` +
        `${suggestion.crossBook ? "  [CROSS-BOOK → owner]" : ""}`,
    );
  }

  if (skipped.length > 0) {
    console.log("");
    console.log(
      "Contested, so left for you — confirm these individually after " +
        "looking at them:",
    );
    for (const suggestion of skipped) {
      console.log(
        `  ${suggestion.date.toISOString().slice(0, 10)} ` +
          `${formatNZD(suggestion.amountCents)}  ` +
          `out: ${suggestion.outDescription}  |  in: ${suggestion.inDescription}`,
      );
      console.log(
        `    npm run transfers:confirm -- --out ${suggestion.outLegId} ` +
          `--in ${suggestion.inLegId} --confirm`,
      );
    }
  }

  console.log("");

  if (!confirm) {
    console.log("Dry run — re-run with --confirm to write.");
    return;
  }

  let written = 0;
  const failures: string[] = [];

  for (const suggestion of eligible) {
    try {
      await writePair(prisma, suggestion.outLegId, suggestion.inLegId);
      written += 1;
    } catch (err) {
      // One leg may have been claimed by an earlier pair in this same batch.
      // Reporting and continuing beats aborting halfway with no summary.
      failures.push(
        `${suggestion.outLegId} ↔ ${suggestion.inLegId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  console.log(`Wrote ${written} pairs.`);

  if (failures.length > 0) {
    console.log("");
    console.log(`${failures.length} could not be written:`);
    for (const failure of failures) console.log(`  ${failure}`);
  }
});

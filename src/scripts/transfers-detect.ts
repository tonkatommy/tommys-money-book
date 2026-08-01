// Find transfer pairs. `npm run transfers:detect`
//
// Tier 1 (ANZ internal, reciprocal descriptions) is deterministic and gets
// written. Everything else is listed as a suggestion for you to confirm with
// `npm run transfers:confirm`.
//
//   npm run transfers:detect                 # dry run
//   npm run transfers:detect -- --confirm    # write the tier 1 pairs
//   npm run transfers:detect -- --suggestions 40

import { runScript } from "./_run";
import { parseArgs } from "./_args";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { checkPairIntegrity, detectTransfers } from "@/lib/transfers/run";

void runScript("transfers:detect", async () => {
  const args = parseArgs(process.argv.slice(2));
  const confirm = args.flag("confirm");
  const suggestionLimit = Number(args.value("suggestions") ?? 25);
  args.rejectUnknown();

  const result = await detectTransfers(prisma, { dryRun: !confirm });

  console.log("");
  console.log("TIER 1 — ANZ internal transfers (deterministic)");
  console.log("");
  console.log(`  pairs found       ${result.tier1Pairs.length}`);
  console.log(
    `  interchangeable   ${result.tier1Pairs.filter((p) => p.interchangeable).length}` +
      `  (same date, amount and accounts — any assignment gives identical books)`,
  );
  console.log(
    `  external          ${result.tier1External.length}` +
      `  (names an account we don't hold — left unpaired on purpose)`,
  );
  console.log(`  unmatched         ${result.tier1Unmatched.length}`);
  console.log(`  written           ${confirm ? result.written : 0}`);

  for (const leg of result.tier1External) {
    console.log(`    external: ${formatNZD(leg.amountCents)}  ${leg.description}`);
  }
  for (const leg of result.tier1Unmatched) {
    console.log(`    UNMATCHED: ${formatNZD(leg.amountCents)}  ${leg.description}`);
  }

  // --- Tier 2 ---------------------------------------------------------------
  const suggestions = result.suggestions;
  const byConfidence = (level: string): number =>
    suggestions.filter((s) => s.confidence === level).length;

  console.log("");
  console.log("TIER 2 — suggestions, confirm by hand");
  console.log("");
  console.log(
    `  ${suggestions.length} candidates  ` +
      `(${byConfidence("HIGH")} high, ${byConfidence("MEDIUM")} medium, ` +
      `${byConfidence("LOW")} low)`,
  );
  console.log(
    `  ${suggestions.filter((s) => s.contested).length} contested — the same ` +
      `outgoing leg has more than one plausible counterpart.`,
  );
  console.log("");
  console.log(
    "  Nothing here is written automatically. Over this baseline a real " +
      "standing order collides with a real flatmate payment on the same day " +
      "for the same amount, repeatedly — auto-netting the wrong one would " +
      "erase income and still leave the books balanced.",
  );
  console.log("");

  for (const suggestion of suggestions.slice(0, suggestionLimit)) {
    const marks = [
      suggestion.confidence,
      suggestion.contested ? "CONTESTED" : null,
      suggestion.crossBook ? "CROSS-BOOK" : null,
    ]
      .filter(Boolean)
      .join(" ");

    console.log(
      `  ${suggestion.date.toISOString().slice(0, 10)}  ` +
        `${formatNZD(suggestion.amountCents).padStart(12)}  ${marks}`,
    );
    console.log(
      `    ${suggestion.fromAccount} → ${suggestion.toAccount}`,
    );
    console.log(`    out: ${suggestion.outDescription}`);
    console.log(`    in:  ${suggestion.inDescription}`);
    for (const reason of suggestion.reasons) console.log(`    · ${reason}`);
    console.log(
      `    npm run transfers:confirm -- --out ${suggestion.outLegId} ` +
        `--in ${suggestion.inLegId}`,
    );
    console.log("");
  }

  if (suggestions.length > suggestionLimit) {
    console.log(
      `  … and ${suggestions.length - suggestionLimit} more ` +
        `(--suggestions to see them)`,
    );
    console.log("");
  }

  // --- The invariant --------------------------------------------------------
  const problems = await checkPairIntegrity(prisma);
  if (problems.length === 0) {
    console.log("Every stored pair has exactly two legs summing to zero.");
  } else {
    console.log("PAIR INTEGRITY FAILURES:");
    for (const problem of problems) {
      console.log(
        `  ${problem.transferPairId}: ${problem.legs} legs, ` +
          `net ${formatNZD(problem.netCents)}`,
      );
    }
  }

  if (!confirm) {
    console.log("");
    console.log("Dry run — re-run with --confirm to write the tier 1 pairs.");
  }
});

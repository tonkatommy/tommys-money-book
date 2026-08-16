"use server";

// Confirming transfer pairs from the UI.
//
// The confidence level is the only thing the form posts. Which pairs get
// written is re-derived here, exactly as `transfers:confirm --confidence`
// does — a Server Action is reachable as a direct POST, so a list of leg ids
// in the request would be a list somebody else chose, and mis-pairing two legs
// nets real money to zero while leaving the books balanced.
//
// Contested suggestions are never written by this path, at any confidence.
// That is the whole reason tier 2 exists: over this baseline a real standing
// order collides with a real flatmate payment on the same day for the same
// amount, repeatedly, and picking one would erase income invisibly. Those stay
// a CLI job with a human looking at them (Phase 3a spec §1).

import { revalidatePath } from "next/cache";
import { hasSession } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { detectTransfers, writePair } from "@/lib/transfers/run";

export type FormState = { ok: false; error: string } | { ok: true; wrote: number } | undefined;

export async function confirmGroupAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) {
    return { ok: false, error: "Your session has expired. Reload and sign in again." };
  }

  const confidence = String(formData.get("confidence") ?? "").toUpperCase();
  if (!["HIGH", "MEDIUM", "LOW"].includes(confidence)) {
    return { ok: false, error: "That isn't a confidence level." };
  }

  const { suggestions } = await detectTransfers(prisma, { dryRun: true });
  const eligible = suggestions.filter(
    (suggestion) => suggestion.confidence === confidence && !suggestion.contested,
  );

  if (eligible.length === 0) {
    return { ok: false, error: "Nothing uncontested is left at that level." };
  }

  let wrote = 0;
  const failures: string[] = [];

  for (const suggestion of eligible) {
    try {
      await writePair(prisma, suggestion.outLegId, suggestion.inLegId);
      wrote += 1;
    } catch (error) {
      // One leg may have been claimed by an earlier pair in this same batch.
      // Reporting and continuing beats aborting halfway with no summary — the
      // same choice the CLI makes.
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  revalidatePath("/transfers");
  revalidatePath("/transactions");
  revalidatePath("/budget");

  if (failures.length > 0) {
    console.error("[transfers] some pairs could not be written", failures);
    return {
      ok: false,
      error: `Wrote ${wrote}, but ${failures.length} could not be paired. Run \`npm run transfers:detect\` to see why.`,
    };
  }

  return { ok: true, wrote };
}

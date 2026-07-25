// Entry point for the Akahu seam. Import from here, never from ./live directly.

import { FixtureAkahuGateway } from "./fixture";
import { LiveAkahuGateway } from "./live";
import type { AkahuGateway } from "./types";

export type {
  AkahuGateway,
  NormalisedAccount,
  NormalisedTransaction,
  TransactionWindow,
} from "./types";

/**
 * Build the gateway the current environment asks for.
 *
 * Defaults to `fixture`. That's the safe default in both directions: a
 * misconfigured container syncs fake data into a dev database rather than
 * hammering the real Akahu API, and forgetting to set the mode can't quietly
 * put fake transactions in the live book either — the status page shows which
 * mode each run used, and every startup logs it.
 *
 * Live mode fails fast on missing tokens instead of starting up and syncing
 * nothing every morning, which is the failure that hides for weeks.
 */
export function createGateway(): AkahuGateway {
  const mode = (process.env.AKAHU_MODE ?? "fixture").trim().toLowerCase();

  switch (mode) {
    case "live":
      return LiveAkahuGateway.fromEnv();
    case "fixture":
      console.log(
        "[akahu] fixture mode — using src/lib/akahu/fixtures/akahu.json, " +
          "no network calls. Set AKAHU_MODE=live to use real Akahu data.",
      );
      return new FixtureAkahuGateway();
    default:
      throw new Error(
        `Unknown AKAHU_MODE "${mode}". Expected "live" or "fixture".`,
      );
  }
}

// The seam between Akahu and the rest of the app.
//
// Nothing outside src/lib/akahu/ imports the `akahu` package. Everything else
// depends on the `AkahuGateway` interface and the normalised shapes below.
//
// Two reasons this is worth the extra file:
//
//  1. Testability. There are no real Akahu tokens yet, and even once there
//     are, hitting a live bank API in a test is a bad idea (rate limits, and
//     yesterday's data changes today). A second implementation backed by JSON
//     fixtures gives us a full sync to develop against.
//  2. Blast radius. If Akahu changes its API — or the plan's §8 risk lands and
//     personal-app terms change — the damage is contained to this directory
//     instead of spread through every file that touches a transaction.
//
// The normalised types are also where the messy parts of the wire format get
// cleaned up once: float dollars become integer cents, ISO strings become
// Dates, and "field might be missing" becomes an explicit `| null`.

/** An Akahu account, normalised. Money in cents, timestamps as Dates. */
export type NormalisedAccount = {
  /** Akahu's stable account id, e.g. "acc_1111...". Our matching key. */
  akahuId: string;
  /** Akahu's connection (bank) name, e.g. "ANZ". Null if not reported. */
  connectionName: string | null;
  /** Akahu's own name for the account, e.g. "Everyday". */
  akahuName: string;
  /** CHECKING / SAVINGS / CREDITCARD / ... */
  accountType: string;
  formattedAccount: string | null;
  currency: string;
  status: "ACTIVE" | "INACTIVE";
  /** Current balance in cents. Null when Akahu didn't report one. */
  balanceCents: number | null;
  /** When Akahu last refreshed that balance. */
  balanceAsAt: Date | null;
  /**
   * Whether this account supports transaction retrieval at all. A rewards or
   * KiwiSaver account may not — syncing it would fail every single run and
   * make a healthy sync look broken.
   */
  supportsTransactions: boolean;
};

/** An Akahu transaction, normalised. */
export type NormalisedTransaction = {
  /** Akahu's stable transaction id — becomes our unique externalId. */
  externalId: string;
  akahuAccountId: string;
  /** Posting date at UTC midnight; see normalise.ts for why UTC. */
  date: Date;
  description: string;
  amountCents: number;
  /** Running balance after this transaction, when the bank reported one. */
  balanceAfterCents: number | null;
  akahuType: string | null;
  merchantName: string | null;
  akahuCategoryName: string | null;
  akahuCategoryGroup: string | null;
  /** The untouched payload, stored for Phase 2 category discovery. */
  raw: unknown;
};

/**
 * The date range to fetch.
 *
 * Mirrors Akahu's semantics exactly so the two implementations can't disagree:
 * `start` is EXCLUSIVE, `end` is INCLUSIVE. Omitting `start` is not the same as
 * "everything" — the SDK defaults it to 30 days ago — so the baseline pull
 * always passes an explicit floor.
 */
export type TransactionWindow = {
  start?: Date;
  end?: Date;
};

export interface AkahuGateway {
  /** "live" or "fixture" — logged on every run so it's never ambiguous. */
  readonly mode: "live" | "fixture";
  listAccounts(): Promise<NormalisedAccount[]>;
  listTransactions(
    akahuAccountId: string,
    window: TransactionWindow,
  ): Promise<NormalisedTransaction[]>;
  /**
   * Total unsettled authorisations per account, keyed by Akahu account id.
   *
   * Totals, deliberately, rather than the transactions themselves. Pending
   * rows carry unstable ids and their amounts change when they settle, so
   * importing them would poison `externalId` dedupe and leave phantom rows
   * behind when they vanish. The only thing needed is the sum, because the
   * bank's reported balance already includes these — see
   * src/lib/sync/reconcile.ts.
   *
   * Accounts with nothing pending are simply absent from the map.
   */
  pendingTotalsByAccount(): Promise<Map<string, number>>;
}

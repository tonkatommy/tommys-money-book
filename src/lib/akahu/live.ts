// The real Akahu client. The only file in the project that imports `akahu`.

import { AkahuClient, type Cursor } from "akahu";

import { dollarsToCents } from "@/lib/money";
import { requireSecret, redact } from "@/lib/secrets";
import { normaliseAccount, normaliseTransaction } from "./normalise";
import type {
  AkahuGateway,
  NormalisedAccount,
  NormalisedTransaction,
  TransactionWindow,
} from "./types";

// A runaway cursor loop against a paginated API is a good way to get rate
// limited (or billed, on a paid plan). Akahu pages are ~100 transactions, so
// 500 pages is ~50,000 transactions — far beyond a two-year personal history,
// and therefore a sign something is wrong rather than a legitimate large pull.
const MAX_PAGES = 500;

export class LiveAkahuGateway implements AkahuGateway {
  readonly mode = "live" as const;

  private readonly client: AkahuClient;
  private readonly userToken: string;

  constructor(appToken: string, userToken: string) {
    // Personal apps authenticate with two tokens: the app token identifies the
    // application (X-Akahu-Id header) and the user token authorises access to
    // one Akahu profile's accounts (Authorization: Bearer). The SDK takes the
    // app token at construction and the user token per call.
    this.client = new AkahuClient({
      appToken,
      // Akahu is a homelab-to-internet call over a domestic connection, so a
      // transient network blip shouldn't fail the morning's sync. Retries only
      // apply to network errors, never to API error responses.
      timeout: 30_000,
      retries: 2,
    });
    this.userToken = userToken;
  }

  /** Build from environment (or Docker secret files). Never logs the values. */
  static fromEnv(): LiveAkahuGateway {
    const appToken = requireSecret("AKAHU_APP_TOKEN");
    const userToken = requireSecret("AKAHU_USER_TOKEN");

    console.log(
      `[akahu] live mode — app token ${redact(appToken)}, ` +
        `user token ${redact(userToken)}`,
    );

    return new LiveAkahuGateway(appToken, userToken);
  }

  async listAccounts(): Promise<NormalisedAccount[]> {
    const accounts = await this.client.accounts.list(this.userToken);
    return accounts.map(normaliseAccount);
  }

  /**
   * Sum Akahu's pending transactions, per account.
   *
   * One profile-wide call rather than one per account: Akahu's
   * /transactions/pending returns every connected account's pending rows at
   * once, and eleven separate requests to learn the same thing would be
   * eleven chances to get rate limited.
   */
  async pendingTotalsByAccount(): Promise<Map<string, number>> {
    const pending = await this.client.transactions.listPending(this.userToken);
    const totals = new Map<string, number>();

    for (const transaction of pending) {
      // Float dollars from the wire, exactly as with settled transactions —
      // so they cross into integer cents at the same boundary. Summing the
      // floats first and converting once would reintroduce the drift the
      // whole money module exists to prevent.
      const cents = dollarsToCents(transaction.amount);
      totals.set(
        transaction._account,
        (totals.get(transaction._account) ?? 0) + cents,
      );
    }

    return totals;
  }

  async listTransactions(
    akahuAccountId: string,
    window: TransactionWindow,
  ): Promise<NormalisedTransaction[]> {
    const transactions: NormalisedTransaction[] = [];

    // Cursor pagination: each page carries the cursor for the next one, and a
    // null `next` means we've reached the end. Passing a null cursor back to
    // Akahu is an error, so the loop condition checks for it explicitly rather
    // than relying on a falsy check (an empty-string cursor would slip through).
    let cursor: Cursor;
    let pages = 0;

    do {
      const page = await this.client.accounts.listTransactions(
        this.userToken,
        akahuAccountId,
        {
          // Only send the bounds we actually have. Note that omitting `start`
          // makes Akahu default to 30 days ago, not "everything" — callers
          // doing a baseline pull must pass an explicit start date.
          ...(window.start ? { start: window.start.toISOString() } : {}),
          ...(window.end ? { end: window.end.toISOString() } : {}),
          cursor,
        },
      );

      // Note: this is the *settled* transactions endpoint. Pending transactions
      // live behind a separate call and are deliberately not imported — they
      // get different, unstable ids that would break externalId dedupe, and
      // they change amount or vanish entirely when they settle.
      transactions.push(...page.items.map(normaliseTransaction));

      cursor = page.cursor.next;
      pages += 1;

      if (pages >= MAX_PAGES && cursor !== null) {
        throw new Error(
          `Akahu pagination exceeded ${MAX_PAGES} pages for account ` +
            `${akahuAccountId} — aborting rather than looping forever.`,
        );
      }
    } while (cursor !== null && cursor !== undefined);

    return transactions;
  }
}

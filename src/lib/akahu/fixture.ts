// A stand-in for Akahu backed by JSON fixtures.
//
// This exists so the whole sync pipeline — accounts, transactions, dedupe,
// reconciliation, the cron worker, the status page — can be built and verified
// before a single real token exists. Once tokens arrive, flipping
// AKAHU_MODE=live is the only change.
//
// The important discipline: this must behave like Akahu, not like whatever is
// convenient. It runs the same normalise functions and applies the same
// exclusive-start / inclusive-end window semantics. A fixture that's "close
// enough" tests nothing, because the bugs live exactly in the differences.

import type { Account, Transaction } from "akahu";

import { normaliseAccount, normaliseTransaction } from "./normalise";
import type {
  AkahuGateway,
  NormalisedAccount,
  NormalisedTransaction,
  TransactionWindow,
} from "./types";

import fixtures from "./fixtures/akahu.json";

type Fixtures = {
  accounts: Account[];
  transactions: Transaction[];
};

export class FixtureAkahuGateway implements AkahuGateway {
  readonly mode = "fixture" as const;

  private readonly data: Fixtures;

  constructor(data?: Fixtures) {
    // The cast is contained here. The JSON is hand-written to match Akahu's
    // documented response shapes; TypeScript can't verify that from a .json
    // import, so this single assertion is the price of not hand-writing 500
    // lines of typed object literals.
    this.data = data ?? (fixtures as unknown as Fixtures);
  }

  async listAccounts(): Promise<NormalisedAccount[]> {
    return this.data.accounts.map(normaliseAccount);
  }

  async listTransactions(
    akahuAccountId: string,
    window: TransactionWindow,
  ): Promise<NormalisedTransaction[]> {
    return this.data.transactions
      .filter((transaction) => transaction._account === akahuAccountId)
      .map(normaliseTransaction)
      .filter((transaction) => inWindow(transaction.date, window))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }
}

/**
 * Akahu's window semantics, reproduced exactly: `start` is EXCLUSIVE, `end` is
 * INCLUSIVE.
 *
 * That asymmetry is easy to shrug at and expensive to get wrong. An inclusive
 * start would re-fetch the boundary transaction on every incremental sync
 * (harmless — dedupe absorbs it) but an inclusive-vs-exclusive mix-up in the
 * other direction silently drops it. Copying the real semantics means the
 * fixture can actually catch that class of bug.
 */
function inWindow(date: Date, window: TransactionWindow): boolean {
  if (window.start && date.getTime() <= window.start.getTime()) return false;
  if (window.end && date.getTime() > window.end.getTime()) return false;
  return true;
}

// Wire format -> our shapes. Pure functions, no I/O, so they're cheap to test.
//
// Both the live gateway and the fixture gateway run everything through here,
// which is what makes the fixture a faithful stand-in rather than an
// approximation that drifts.

import type { Account, Transaction } from "akahu";

import { dollarsToCents } from "@/lib/money";
import type { NormalisedAccount, NormalisedTransaction } from "./types";

/**
 * Akahu timestamps are ISO 8601 in UTC, and posting dates come through as UTC
 * midnight ("2026-03-15T00:00:00.000Z"). Our `date` column is a bare DATE with
 * no time or zone, so we take the UTC calendar date and keep it.
 *
 * The temptation is to convert to Pacific/Auckland first. Don't. NZ is UTC+12
 * or +13, so a UTC-midnight timestamp is already noon-or-later on the *same*
 * NZ day — converting changes nothing for the normal case, but it would shift
 * any transaction Akahu happens to stamp after 12:00Z onto the following day.
 * Taking the UTC date is stable, and it's the date the bank reported.
 *
 * (Financial-year bucketing in later phases derives from this column, so its
 * consistency matters more than its timezone philosophy.)
 */
export function toPostingDate(isoTimestamp: string): Date {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Unparseable Akahu date: ${isoTimestamp}`);
  }
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

export function normaliseAccount(account: Account): NormalisedAccount {
  const balance = account.balance;

  return {
    akahuId: account._id,
    connectionName: account.connection?.name ?? null,
    akahuName: account.name,
    accountType: account.type,
    formattedAccount: account.formatted_account ?? null,
    currency: balance?.currency ?? "NZD",
    status: account.status,
    // `current` is the real balance; `available` subtracts holds and pending
    // authorisations, which would fight with our settled-only transaction set.
    balanceCents:
      typeof balance?.current === "number"
        ? dollarsToCents(balance.current)
        : null,
    balanceAsAt: account.refreshed?.balance
      ? new Date(account.refreshed.balance)
      : null,
    supportsTransactions: account.attributes?.includes("TRANSACTIONS") ?? false,
  };
}

/**
 * Build a human-readable account name, e.g. "ANZ Everyday".
 *
 * Akahu account names alone collide easily — both banks will happily call an
 * account "Everyday" — and `Account.name` is unique in our schema. Prefixing
 * with the connection makes collisions rare; the importer handles the rest.
 */
export function buildAccountName(account: NormalisedAccount): string {
  return account.connectionName
    ? `${account.connectionName} ${account.akahuName}`.trim()
    : account.akahuName;
}

export function normaliseTransaction(
  transaction: Transaction,
): NormalisedTransaction {
  // Akahu returns either a RawTransaction or an EnrichedTransaction from the
  // same endpoint depending on the app's permissions, and the enrichment can
  // be partial even then. Narrowing with `in` rather than casting means an
  // unenriched transaction imports cleanly with nulls instead of throwing.
  const enriched = transaction as Partial<
    Extract<Transaction, { merchant: unknown }>
  >;

  return {
    externalId: transaction._id,
    akahuAccountId: transaction._account,
    date: toPostingDate(transaction.date),
    description: transaction.description,
    amountCents: dollarsToCents(transaction.amount),
    balanceAfterCents:
      typeof transaction.balance === "number"
        ? dollarsToCents(transaction.balance)
        : null,
    akahuType: transaction.type ?? null,
    merchantName: enriched.merchant?.name ?? null,
    akahuCategoryName: enriched.category?.name ?? null,
    // Akahu groups its ~100 categories several ways; personal_finance is the
    // grouping meant for budgeting, and the one Phase 2 will build on.
    akahuCategoryGroup:
      enriched.category?.groups?.personal_finance?.name ?? null,
    raw: transaction,
  };
}

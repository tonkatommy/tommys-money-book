// Writing Akahu data into Postgres.
//
// Everything in here is idempotent: running it twice must leave the database
// in exactly the state one run would. That property is what makes a daily
// cron job safe — a retry after a half-finished run can't corrupt anything.

import type { Account, Prisma, PrismaClient } from "@/generated/prisma/client";
import { buildAccountName } from "@/lib/akahu/normalise";
import type { NormalisedAccount, NormalisedTransaction } from "@/lib/akahu";

export type ImportCounts = {
  /** How many transactions Akahu handed us. */
  fetched: number;
  /** How many were genuinely new. */
  inserted: number;
  /** fetched - inserted. Expected to be non-zero on incremental runs. */
  duplicates: number;
};

/**
 * Create or update Account rows from Akahu, returning them all.
 *
 * The matching key is `akahuId`, never the name — bank account nicknames get
 * changed, and matching on a mutable field would create a duplicate account
 * (and orphan its transaction history) the day you rename something in
 * internet banking.
 */
export async function upsertAccounts(
  prisma: PrismaClient,
  accounts: readonly NormalisedAccount[],
): Promise<Account[]> {
  const results: Account[] = [];

  for (const incoming of accounts) {
    const existing = await prisma.account.findUnique({
      where: { akahuId: incoming.akahuId },
    });

    // Fields we always take from Akahu, because Akahu is authoritative for
    // them. Note `book` is conspicuously absent — see below.
    const fromAkahu = {
      akahuId: incoming.akahuId,
      connectionName: incoming.connectionName,
      akahuName: incoming.akahuName,
      accountType: incoming.accountType,
      formattedAccount: incoming.formattedAccount,
      currency: incoming.currency,
      status: incoming.status,
      balanceCents: incoming.balanceCents,
      balanceAsAt: incoming.balanceAsAt,
    };

    if (existing) {
      // Updating deliberately does NOT touch `book`, `openingBalanceCents`,
      // `historyStartDate` or `lastTransactionAt`. Those are ours, not
      // Akahu's: a sync that silently reset the book assignment every morning
      // would undo the one piece of human judgement in the whole pipeline.
      results.push(
        await prisma.account.update({
          where: { id: existing.id },
          data: fromAkahu,
        }),
      );
      continue;
    }

    results.push(
      await prisma.account.create({
        data: {
          ...fromAkahu,
          name: await uniqueAccountName(prisma, buildAccountName(incoming)),
          // book stays null: "discovered, not yet assigned". The status page
          // flags it and `npm run accounts:map` resolves it.
        },
      }),
    );
  }

  return results;
}

/**
 * Find a free value for the unique `name` column.
 *
 * Both banks will happily call an account "Everyday", and the connection
 * prefix ("ANZ Everyday") usually separates them — but not if you hold two
 * accounts with the same nickname at the same bank. Suffixing beats crashing
 * the baseline pull, and the name is cosmetic anyway; `akahuId` is identity.
 */
async function uniqueAccountName(
  prisma: PrismaClient,
  preferred: string,
): Promise<string> {
  let candidate = preferred;
  let suffix = 2;

  while (await prisma.account.findUnique({ where: { name: candidate } })) {
    candidate = `${preferred} (${suffix})`;
    suffix += 1;
  }

  return candidate;
}

/**
 * Insert transactions, discarding any we already hold.
 *
 * `skipDuplicates` turns the unique constraint on `externalId` into the dedupe
 * mechanism. This is on purpose: the alternative — reading existing ids into
 * memory and filtering in JavaScript — has a race window and depends on
 * application code being correct forever. Here the database refuses the
 * duplicate no matter what the application believes, which is the guarantee
 * the old spreadsheet never had.
 *
 * The difference between what we sent and what landed is the duplicate count,
 * and seeing it stay non-zero on daily runs is how we know dedupe is live.
 */
export async function importTransactions(
  prisma: PrismaClient,
  accountId: string,
  transactions: readonly NormalisedTransaction[],
): Promise<ImportCounts> {
  if (transactions.length === 0) {
    return { fetched: 0, inserted: 0, duplicates: 0 };
  }

  const rows: Prisma.TransactionCreateManyInput[] = transactions.map((tx) => ({
    accountId,
    date: tx.date,
    description: tx.description,
    amountCents: tx.amountCents,
    // Akahu's merchant is the closest thing to a payee. Phase 3 lets it be
    // edited by hand; until then it's a starting point, not a decision.
    payee: tx.merchantName,
    source: "AKAHU",
    externalId: tx.externalId,
    merchantName: tx.merchantName,
    akahuCategoryName: tx.akahuCategoryName,
    akahuCategoryGroup: tx.akahuCategoryGroup,
    akahuType: tx.akahuType,
    balanceAfterCents: tx.balanceAfterCents,
    raw: tx.raw as Prisma.InputJsonValue,
    // categoryId stays null. Phase 1 imports raw and uncategorised on
    // purpose — Phase 2 builds the category list from this very data.
  }));

  const { count: inserted } = await prisma.transaction.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return {
    fetched: rows.length,
    inserted,
    duplicates: rows.length - inserted,
  };
}

/**
 * Sum every stored transaction for an account, in cents.
 *
 * Done as a database aggregate rather than by loading rows into memory: the
 * sum is the only thing we want, and after a few years there could be tens of
 * thousands of rows.
 */
export async function storedTotalCents(
  prisma: PrismaClient,
  accountId: string,
): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: { accountId },
    _sum: { amountCents: true },
  });

  // _sum is null when there are no matching rows — an empty sum is zero.
  return result._sum.amountCents ?? 0;
}

/** The latest transaction date we hold for an account, or null. */
export async function latestTransactionDate(
  prisma: PrismaClient,
  accountId: string,
): Promise<Date | null> {
  const result = await prisma.transaction.aggregate({
    where: { accountId },
    _max: { date: true },
  });

  return result._max.date ?? null;
}

/** The earliest transaction date we hold — an account's day zero. */
export async function earliestTransactionDate(
  prisma: PrismaClient,
  accountId: string,
): Promise<Date | null> {
  const result = await prisma.transaction.aggregate({
    where: { accountId },
    _min: { date: true },
  });

  return result._min.date ?? null;
}

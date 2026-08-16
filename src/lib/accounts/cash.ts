// The two accounts manual entries live in.
//
// `Transaction.accountId` is required, so cash the bank never saw still needs
// an account to hang off. It must not be a real one: a bank account's balance
// comes from Akahu and is reconciled against the sum of its transactions, so a
// row we invented would make that account permanently fail to reconcile — and
// the reconciliation check is the thing that would otherwise tell us the sync
// is broken.
//
// These are recognised by name rather than by a flag on Account. The schema's
// Akahu-facing paths already key off `akahuId`, and every one of them —
// sync, reconciliation, balance refresh — skips an account without one, so a
// null `akahuId` is the only marker needed and no migration is required to
// introduce them.

import type { Book, PrismaClient } from "@/generated/prisma/client";

/** Exact names, and the key the seed upserts on. */
export const CASH_ACCOUNT_NAMES: Record<Book, string> = {
  PERSONAL: "Cash — Personal",
  BUSINESS: "Cash — Business",
};

/**
 * Create the cash accounts if they aren't there. Idempotent.
 *
 * Upsert by name, the same idempotency style as `categories:seed`: running it
 * twice is free, and it never touches an account that already exists beyond
 * making sure it is in the right book.
 */
export async function seedCashAccounts(
  prisma: PrismaClient,
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const book of ["PERSONAL", "BUSINESS"] as const) {
    const name = CASH_ACCOUNT_NAMES[book];
    const before = await prisma.account.findUnique({ where: { name } });

    await prisma.account.upsert({
      where: { name },
      create: {
        name,
        book,
        // No akahuId: this is what keeps sync, reconciliation and the balance
        // refresh away from it.
        akahuId: null,
        accountType: "CASH",
        // Not null. A null balance reads as "we don't know yet" on the status
        // page, and for cash we do know: nothing is claimed about it.
        balanceCents: 0,
      },
      update: { book },
    });

    if (before) existing += 1;
    else created += 1;
  }

  return { created, existing };
}

/**
 * The cash account id for a book, or null if it hasn't been seeded.
 *
 * Null rather than creating one on demand: a read path that writes means every
 * page load needs a writable database, and the caller has a better error to
 * show than a silent insert would produce.
 */
export async function cashAccountId(
  prisma: PrismaClient,
  book: Book,
): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { name: CASH_ACCOUNT_NAMES[book] },
    select: { id: true },
  });
  return account?.id ?? null;
}

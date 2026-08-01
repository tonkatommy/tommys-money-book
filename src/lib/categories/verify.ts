// Checks that the categorised books are internally consistent.
//
// These are the assertions the tax reports will silently depend on. Each one
// is here because getting it wrong produces a *plausible* wrong answer rather
// than an error — the books balance, the totals look reasonable, and the
// number handed to the accountant is simply not true.

import type { PrismaClient, TaxTag } from "@/generated/prisma/client";

export type BookMismatch = {
  transactionId: string;
  date: Date;
  description: string;
  accountName: string;
  accountBook: string | null;
  categoryName: string;
  categoryBook: string;
};

/**
 * The golden rule, checked against what's actually stored.
 *
 * The matcher and the bulk re-categoriser both refuse to cross books, so this
 * should always be empty. That's the point: it verifies the guards work
 * rather than trusting that they do, and it would also catch a bad manual
 * UPDATE or a future code path that forgets.
 */
export async function findBookMismatches(
  prisma: PrismaClient,
): Promise<BookMismatch[]> {
  const rows = await prisma.transaction.findMany({
    where: { categoryId: { not: null } },
    select: {
      id: true,
      date: true,
      description: true,
      account: { select: { name: true, book: true } },
      category: { select: { name: true, book: true } },
    },
  });

  return rows
    .filter((row) => row.category && row.account.book !== row.category.book)
    .map((row) => ({
      transactionId: row.id,
      date: row.date,
      description: row.description,
      accountName: row.account.name,
      accountBook: row.account.book,
      categoryName: row.category!.name,
      categoryBook: row.category!.book,
    }));
}

export type TaxTagTotal = {
  taxTag: TaxTag | null;
  transactions: number;
  netCents: number;
};

/** Totals by tax tag — the shape the IR3 pack will read. */
export async function taxTagTotals(
  prisma: PrismaClient,
): Promise<TaxTagTotal[]> {
  const categories = await prisma.category.findMany({
    select: {
      taxTag: true,
      transactions: { select: { amountCents: true } },
    },
  });

  const totals = new Map<string, TaxTagTotal>();

  for (const category of categories) {
    const key = category.taxTag ?? "(untagged)";
    const existing = totals.get(key) ?? {
      taxTag: category.taxTag,
      transactions: 0,
      netCents: 0,
    };

    for (const transaction of category.transactions) {
      existing.transactions += 1;
      existing.netCents += transaction.amountCents;
    }

    totals.set(key, existing);
  }

  return [...totals.values()].sort((a, b) =>
    (a.taxTag ?? "zzz").localeCompare(b.taxTag ?? "zzz"),
  );
}

/**
 * Rolling 12-month business turnover — the GST registration monitor.
 *
 * Reads BIZ_INCOME only, which is exactly why owner contributions are an
 * OWNER category rather than income. Over this baseline the difference is
 * $982.84 against $2,612.84: capital Tommy put into his own business would
 * otherwise have been counted as sales, inflating turnover by 166%.
 *
 * The $60,000 threshold is a long way off, but the number has to be right
 * *before* it matters, not after — registration is triggered by turnover in
 * the past 12 months, so the first time anyone looks at this figure in anger
 * it will already be describing history.
 */
export async function rollingBusinessTurnoverCents(
  prisma: PrismaClient,
  asAt: Date = new Date(),
): Promise<{ netCents: number; from: Date; to: Date; transactions: number }> {
  const from = new Date(asAt);
  from.setFullYear(from.getFullYear() - 1);

  const result = await prisma.transaction.aggregate({
    where: {
      date: { gt: from, lte: asAt },
      category: { taxTag: "BIZ_INCOME" },
    },
    _sum: { amountCents: true },
    _count: { _all: true },
  });

  return {
    netCents: result._sum.amountCents ?? 0,
    transactions: result._count._all,
    from,
    to: asAt,
  };
}

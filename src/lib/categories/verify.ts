// Checks that the categorised books are internally consistent.
//
// These are the assertions the tax reports will silently depend on. Each one
// is here because getting it wrong produces a *plausible* wrong answer rather
// than an error — the books balance, the totals look reasonable, and the
// number handed to the accountant is simply not true.

import type { PrismaClient, TaxTag } from "@/generated/prisma/client";
import { daysInMonth, nzToday, utcDate } from "@/lib/budget/period";

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

const DAY_MS = 86_400_000;

/** The rolling 12-month window the GST monitor sums over. Both ends inclusive. */
export type GstWindow = { from: Date; to: Date };

/**
 * The 12 months ending on `asAt`, as UTC-midnight calendar dates.
 *
 * Pulled out of the query and exported because this, not the sum, is where
 * the figure can go quietly wrong, and it is the only part of the monitor
 * that can be tested without a database.
 *
 * Two things it exists to get right:
 *
 * 1. `asAt` is a CALENDAR DATE, not an instant. `Transaction.date` is a bare
 *    `@db.Date` that Postgres returns at UTC midnight, and NZ runs 12–13
 *    hours ahead of UTC. Compare those stored dates against `new Date()` and
 *    from NZ midnight until NZ noon today's date has not arrived in UTC yet,
 *    so today's sales are outside the window — and the far end of the window
 *    slides with the clock too, which means the answer at 9am and the answer
 *    at 9pm are sums over different 12 months. So "today" resolves in
 *    Pacific/Auckland via `nzToday` first (invariant 5).
 *
 * 2. A year back from 29 February lands on a date that does not exist.
 *    `setFullYear` on a mutated copy rolls it silently into 1 March; the
 *    clamped `utcDate` arithmetic `period.ts` uses for short anchor days
 *    gives 28 February instead, and the window keeps its stated length.
 *
 * `from` is the first day INCLUDED — the day after the same date a year
 * earlier — so `from`..`to` is a full 12 months with no day counted twice
 * across consecutive windows.
 */
export function gstWindow(asAt: Date = nzToday()): GstWindow {
  const year = asAt.getUTCFullYear() - 1;
  const month = asAt.getUTCMonth();
  const sameDateLastYear = utcDate(
    year,
    month,
    Math.min(asAt.getUTCDate(), daysInMonth(year, month)),
  );

  return { from: new Date(sameDateLastYear.getTime() + DAY_MS), to: asAt };
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
 * it will already be describing history and cannot be recomputed from a
 * better clock. Hence `gstWindow` above.
 */
export async function rollingBusinessTurnoverCents(
  prisma: PrismaClient,
  asAt: Date = nzToday(),
): Promise<{ netCents: number; from: Date; to: Date; transactions: number }> {
  const { from, to } = gstWindow(asAt);

  const result = await prisma.transaction.aggregate({
    where: {
      // Both ends are inclusive UTC-midnight calendar dates, so this compares
      // like with like against `@db.Date`.
      date: { gte: from, lte: to },
      category: { taxTag: "BIZ_INCOME" },
    },
    _sum: { amountCents: true },
    _count: { _all: true },
  });

  return {
    netCents: result._sum.amountCents ?? 0,
    transactions: result._count._all,
    from,
    to,
  };
}

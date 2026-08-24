// Reads behind the reports screens.
//
// Same split as `src/lib/budget/query.ts`, and the same two conventions, for
// the same reasons:
//
//   - Expenses are stored NEGATIVE and every figure shown is POSITIVE. The
//     flip happens here, once, at the boundary. A component that flips again
//     produces a plausible number with the wrong sign and nothing complains.
//
//   - Only INCOME and EXPENSE categories are read. TRANSFER and OWNER are
//     excluded by that one filter, which is what keeps money moving between
//     Tommy's own accounts out of the totals without a special case — treat a
//     transfer as income and the books show money never earned, and they still
//     balance.
//
// The thing this file cannot fix, and therefore has to report, is the
// uncategorised transaction. Every figure below filters on `category.kind`, so
// a transaction with no category is absent from income, absent from expenses,
// absent from the breakdown, and invisible on the page. The totals still add
// up. `dataQuality` exists so a reports screen can say how complete it is,
// which is half of answering the question at all (3c spec §5).

import { prisma } from "@/lib/prisma";
import type { Book } from "@/generated/prisma/client";
import { nzToday } from "@/lib/budget/period";
import { rollingBusinessTurnoverCents } from "@/lib/categories/verify";
import { fyRangeEnd, fyRangeLabel, type FinancialYear } from "./fy";

/** The GST registration threshold, in cents. IRD's figure, not the app's. */
export const GST_THRESHOLD_CENTS = 60_000_00;

/** One category's total over a range, already flipped to positive. */
export type CategoryTotal = {
  categoryId: string;
  name: string;
  kind: "INCOME" | "EXPENSE";
  taxTag: string | null;
  /** Positive cents. Money earned for INCOME, money spent for EXPENSE. */
  totalCents: number;
  transactions: number;
};

export type DataQuality = {
  /** Transactions in this book and range with no category — see the header. */
  uncategorisedCount: number;
  /** Accounts with `book: null`. Their transactions are in no book at all. */
  unassignedAccountCount: number;
};

export type GstView = {
  netCents: number;
  from: Date;
  to: Date;
  transactions: number;
  thresholdCents: number;
  /** Share of the threshold used, 0–1 and uncapped above it. */
  fraction: number;
};

export type ReportsOverview = {
  fy: FinancialYear;
  book: Book;
  /** The last day actually included — today for a running FY, 31/03 for a closed one. */
  rangeEnd: Date;
  /** "01/04/2026 – 24/08/2026 (to date)". Printed next to every figure. */
  rangeLabel: string;
  incomeCents: number;
  expensesCents: number;
  /** Income less expenses. Negative means the book spent more than it earned. */
  netCents: number;
  categories: CategoryTotal[];
  quality: DataQuality;
  /** Business book only. Meaningless for personal, so it is absent, not zero. */
  gst: GstView | null;
};

/**
 * Every income and expense category's total for a book over a date range.
 *
 * `groupBy` returns ids and sums only, so the names and kinds come from a
 * second read and are joined here — the same shape `categoryViews` uses in the
 * budget layer, and cheap: 63 categories, one round trip.
 *
 * Scoped by the CATEGORY's book rather than the account's. A category may only
 * ever attach to a transaction whose account is in the same book (invariant
 * 1), so the two agree by construction, and going through the category is what
 * lets `kind` do the transfer exclusion in the same filter.
 */
export async function categoryTotals(
  book: Book,
  from: Date,
  to: Date,
): Promise<CategoryTotal[]> {
  const [categories, rows] = await Promise.all([
    prisma.category.findMany({
      where: { book, kind: { in: ["INCOME", "EXPENSE"] } },
      select: { id: true, name: true, kind: true, taxTag: true },
    }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        date: { gte: from, lte: to },
        category: { book, kind: { in: ["INCOME", "EXPENSE"] } },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
  ]);

  const sums = new Map(rows.map((row) => [row.categoryId, row]));

  return categories
    .map((category) => {
      const row = sums.get(category.id);
      const netCents = row?._sum.amountCents ?? 0;

      return {
        categoryId: category.id,
        name: category.name,
        kind: category.kind as "INCOME" | "EXPENSE",
        taxTag: category.taxTag,
        // The one flip. Expenses are stored negative; a refund can still make
        // an expense category net positive, and it should then read as a
        // negative expense rather than being clamped away.
        totalCents: category.kind === "EXPENSE" ? -netCents : netCents,
        transactions: row?._count._all ?? 0,
      };
    })
    .filter((total) => total.transactions > 0)
    .sort((a, b) => Math.abs(b.totalCents) - Math.abs(a.totalCents));
}

/** How complete the figures are. Not decoration — see the file header. */
export async function dataQuality(
  book: Book,
  from: Date,
  to: Date,
): Promise<DataQuality> {
  const [uncategorisedCount, unassignedAccountCount] = await Promise.all([
    prisma.transaction.count({
      where: { date: { gte: from, lte: to }, categoryId: null, account: { book } },
    }),
    // Not scoped by book, because that is exactly the problem: these accounts
    // are in no book, so no book's report can see their transactions.
    prisma.account.count({ where: { book: null } }),
  ]);

  return { uncategorisedCount, unassignedAccountCount };
}

/**
 * The GST registration monitor, for the business book only.
 *
 * The sum lives in `categories/verify.ts` and is imported rather than moved:
 * it is genuinely a verification assertion that the seed script prints and the
 * UI also happens to show, and relocating it would churn that script's import
 * for no gain.
 */
export async function gstView(now: Date = new Date()): Promise<GstView> {
  const turnover = await rollingBusinessTurnoverCents(prisma, nzToday(now));

  return {
    ...turnover,
    thresholdCents: GST_THRESHOLD_CENTS,
    fraction: turnover.netCents / GST_THRESHOLD_CENTS,
  };
}

/** Everything the `/reports` index needs for one book and one financial year. */
export async function getReportsOverview(
  book: Book,
  fy: FinancialYear,
  now: Date = new Date(),
): Promise<ReportsOverview> {
  const today = nzToday(now);
  const rangeEnd = fyRangeEnd(fy, today);

  const [categories, quality, gst] = await Promise.all([
    categoryTotals(book, fy.start, rangeEnd),
    dataQuality(book, fy.start, rangeEnd),
    // A rolling turnover figure against a registration threshold says nothing
    // about the personal book, and showing it there as a zero would only
    // invite the question of why it is zero.
    book === "BUSINESS" ? gstView(now) : null,
  ]);

  const sumOf = (kind: "INCOME" | "EXPENSE"): number =>
    categories
      .filter((category) => category.kind === kind)
      .reduce((total, category) => total + category.totalCents, 0);

  const incomeCents = sumOf("INCOME");
  const expensesCents = sumOf("EXPENSE");

  return {
    fy,
    book,
    rangeEnd,
    rangeLabel: fyRangeLabel(fy, today),
    incomeCents,
    expensesCents,
    netCents: incomeCents - expensesCents,
    categories,
    quality,
    gst,
  };
}

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
import { nzDate, nzToday, utcDate } from "@/lib/budget/period";
import { rollingBusinessTurnoverCents } from "@/lib/categories/verify";
import { fyRangeEnd, fyRangeLabel, type FinancialYear } from "./fy";
import {
  computeBusinessFigures,
  computeHomeOfficeFigures,
  computeRentalFigures,
  computeTaxableIncomeFigures,
  type BusinessFigures,
  type HomeOfficeFigures,
  type RentalFigures,
  type TaxableIncomeFigures,
} from "./ir3";

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

/* ==========================================================================
   The category breakdown, and the monthly breakdown
   ========================================================================== */

/** `getReportsOverview` minus the GST card, plus the two sides split out. */
export type CategoryBreakdown = {
  fy: FinancialYear;
  book: Book;
  rangeEnd: Date;
  rangeLabel: string;
  /** Ranked by magnitude, largest first. Positive cents. */
  income: CategoryTotal[];
  expenses: CategoryTotal[];
  incomeCents: number;
  expensesCents: number;
  netCents: number;
  quality: DataQuality;
};

/**
 * The `/reports/categories` read.
 *
 * Little more than `categoryTotals` split into its two sides, because the two
 * sides are ranked and scaled independently on screen — a $60,000 salary and a
 * $40 phone bill sharing one bar scale is a screen with one visible bar.
 */
export async function getCategoryBreakdown(
  book: Book,
  fy: FinancialYear,
  now: Date = new Date(),
): Promise<CategoryBreakdown> {
  const today = nzToday(now);
  const rangeEnd = fyRangeEnd(fy, today);

  const [categories, quality] = await Promise.all([
    categoryTotals(book, fy.start, rangeEnd),
    dataQuality(book, fy.start, rangeEnd),
  ]);

  const income = categories.filter((category) => category.kind === "INCOME");
  const expenses = categories.filter((category) => category.kind === "EXPENSE");

  const sum = (rows: CategoryTotal[]): number =>
    rows.reduce((total, row) => total + row.totalCents, 0);

  const incomeCents = sum(income);
  const expensesCents = sum(expenses);

  return {
    fy,
    book,
    rangeEnd,
    rangeLabel: fyRangeLabel(fy, today),
    income,
    expenses,
    incomeCents,
    expensesCents,
    netCents: incomeCents - expensesCents,
    quality,
  };
}

/**
 * Month names in FY order, so the label comes from the bucket index.
 *
 * Not `shortDate` from `period.ts`, which formats a day within a month.
 */
const FY_MONTHS = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep",
  "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
];

/** One transaction, reduced to the three fields the bucketing needs. */
export type MonthlyRow = {
  /** The stored `@db.Date`, at UTC midnight. */
  date: Date;
  /** As stored: expenses negative. Flipped once, inside `bucketByMonth`. */
  amountCents: number;
  kind: "INCOME" | "EXPENSE";
};

export type MonthBucket = {
  /** First of the month, UTC midnight. */
  start: Date;
  /** Last of the month, UTC midnight. */
  end: Date;
  /** "Aug 2026" */
  label: string;
  /** "01/08/2026 – 31/08/2026" — every figure prints its range (3c spec §2). */
  range: string;
  /** Positive cents. */
  incomeCents: number;
  /** Positive cents. */
  expensesCents: number;
  netCents: number;
  transactions: number;
  /** Entirely after the last day with data. Not zero spending — no data yet. */
  future: boolean;
  /** Contains the last day with data, so its figures are still moving. */
  partial: boolean;
};

/**
 * Twelve calendar-month buckets across one financial year.
 *
 * Pure, and therefore the only part of this file a unit test can reach — split
 * out from its Prisma call the same way `gstWindow` is split out from
 * `rollingBusinessTurnoverCents` in `categories/verify.ts`.
 *
 * The bucketing is TypeScript rather than SQL because twelve buckets over one
 * year of rows does not justify a `date_trunc` and the codebase's only raw
 * query, and a Prisma `groupBy` cannot produce a calendar month at all.
 *
 * Two things this guarantees that a reduce over the rows would not:
 *
 * - **Always twelve rows.** A month with no transactions is a zero row that
 *   still renders. Building buckets from the data instead gives a table that
 *   changes shape mid-year, where a missing August reads as an August nobody
 *   has looked at rather than an August with nothing in it.
 *
 * - **Months past `rangeEnd` are marked `future`, not zeroed.** In the current
 *   FY, February has not happened. A screen printing $0.00 against it is
 *   asserting something it cannot know.
 *
 * The bucket index is arithmetic on the stored UTC-midnight date. No date
 * parsing, no `new Date(string)`, nothing that could roll a short month
 * forward — the same discipline `period.ts` applies to the pay anchor.
 */
export function bucketByMonth(
  fy: FinancialYear,
  rows: MonthlyRow[],
  rangeEnd: Date,
): MonthBucket[] {
  const firstYear = fy.start.getUTCFullYear();
  const firstMonth = fy.start.getUTCMonth();

  const buckets: MonthBucket[] = Array.from({ length: 12 }, (_, index) => {
    const start = utcDate(firstYear, firstMonth + index, 1);
    // Day 0 of the next month is the last day of this one, so February comes
    // out right in a leap year without a table of month lengths.
    const end = utcDate(start.getUTCFullYear(), start.getUTCMonth() + 1, 0);

    return {
      start,
      end,
      label: `${FY_MONTHS[index]} ${start.getUTCFullYear()}`,
      range: `${nzDate(start)} – ${nzDate(end)}`,
      incomeCents: 0,
      expensesCents: 0,
      netCents: 0,
      transactions: 0,
      future: start.getTime() > rangeEnd.getTime(),
      partial:
        start.getTime() <= rangeEnd.getTime() &&
        end.getTime() > rangeEnd.getTime(),
    };
  });

  for (const row of rows) {
    const index =
      (row.date.getUTCFullYear() - firstYear) * 12 +
      (row.date.getUTCMonth() - firstMonth);

    // A row outside the FY is dropped rather than folded into the first or
    // last bucket. The caller has already filtered on the FY bounds, so this
    // only fires if the two ever disagree — and a total in the wrong month is
    // much harder to spot than one that is missing.
    const bucket = buckets[index];
    if (!bucket) continue;

    // The one flip, at the query boundary, matching `categoryTotals` above.
    // A refund can still make a month's expenses net negative, and it should
    // read that way rather than being clamped to zero.
    if (row.kind === "INCOME") bucket.incomeCents += row.amountCents;
    else bucket.expensesCents += -row.amountCents;

    bucket.transactions += 1;
  }

  for (const bucket of buckets) {
    bucket.netCents = bucket.incomeCents - bucket.expensesCents;
  }

  return buckets;
}

export type MonthlyBreakdown = {
  fy: FinancialYear;
  book: Book;
  rangeEnd: Date;
  rangeLabel: string;
  /** Always twelve, April first. */
  months: MonthBucket[];
  incomeCents: number;
  expensesCents: number;
  netCents: number;
  transactions: number;
  quality: DataQuality;
};

/**
 * The `/reports/months` read — the Financial Breakdown sheet, live.
 *
 * `findMany` rather than `groupBy`, because the grouping key is a calendar
 * month and Prisma cannot group by one. One financial year of one book's
 * categorised rows is a couple of thousand at most and three columns wide;
 * the alternatives are twelve queries or the only raw SQL in the codebase.
 */
export async function getMonthlyBreakdown(
  book: Book,
  fy: FinancialYear,
  now: Date = new Date(),
): Promise<MonthlyBreakdown> {
  const today = nzToday(now);
  const rangeEnd = fyRangeEnd(fy, today);

  const [rows, quality] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        date: { gte: fy.start, lte: rangeEnd },
        // The same filter as `categoryTotals`, so the monthly figures and the
        // category figures are the same money seen two ways. TRANSFER and
        // OWNER fall out of it, which is what stops money moved between
        // Tommy's own accounts showing up as a month's income.
        category: { book, kind: { in: ["INCOME", "EXPENSE"] } },
      },
      select: {
        date: true,
        amountCents: true,
        category: { select: { kind: true } },
      },
    }),
    dataQuality(book, fy.start, rangeEnd),
  ]);

  const months = bucketByMonth(
    fy,
    rows.flatMap((row) =>
      // The `where` above already requires a category, so this never drops a
      // row in practice; it is here because the relation is nullable in the
      // schema and a non-null assertion would be a claim the type cannot make.
      row.category
        ? [
            {
              date: row.date,
              amountCents: row.amountCents,
              kind: row.category.kind as "INCOME" | "EXPENSE",
            },
          ]
        : [],
    ),
    rangeEnd,
  );

  const totalOf = (pick: (bucket: MonthBucket) => number): number =>
    months.reduce((total, bucket) => total + pick(bucket), 0);

  const incomeCents = totalOf((bucket) => bucket.incomeCents);
  const expensesCents = totalOf((bucket) => bucket.expensesCents);

  return {
    fy,
    book,
    rangeEnd,
    rangeLabel: fyRangeLabel(fy, today),
    months,
    incomeCents,
    expensesCents,
    netCents: incomeCents - expensesCents,
    transactions: totalOf((bucket) => bucket.transactions),
    quality,
  };
}

/* ==========================================================================
   The IR3 pack
   ========================================================================== */

/** The two figures the Akahu feed cannot see, as stored for one FY. Null means "not entered yet". */
export type TaxYearAdjustmentView = {
  rentalManagementFeeCents: number | null;
  rentalMortgageInterestCents: number | null;
};

export async function getTaxYearAdjustment(
  fyLabel: string,
): Promise<TaxYearAdjustmentView> {
  const row = await prisma.taxYearAdjustment.findUnique({ where: { fyLabel } });

  return {
    rentalManagementFeeCents: row?.rentalManagementFeeCents ?? null,
    rentalMortgageInterestCents: row?.rentalMortgageInterestCents ?? null,
  };
}

export type Ir3Pack = {
  fy: FinancialYear;
  rangeEnd: Date;
  rangeLabel: string;
  adjustment: TaxYearAdjustmentView;
  rental: RentalFigures;
  business: BusinessFigures;
  homeOffice: HomeOfficeFigures;
  taxableIncome: TaxableIncomeFigures;
  /** Both books — this screen is not scoped to one, see below. */
  personalQuality: DataQuality;
  businessQuality: DataQuality;
};

/**
 * Everything the `/reports/ir3` screen needs for one financial year.
 *
 * Unlike every other reports screen, this one does not take a `book`
 * filter. An IR3 return is one document covering both books at once: rental
 * and other personal income sit in PERSONAL, the business summary in
 * BUSINESS, and the home office deduction spans both by tag rather than by
 * book. See the Phase 4a spec §4.
 */
export async function getIr3Pack(
  fy: FinancialYear,
  now: Date = new Date(),
): Promise<Ir3Pack> {
  const today = nzToday(now);
  const rangeEnd = fyRangeEnd(fy, today);

  const [
    personalCategories,
    businessCategories,
    personalQuality,
    businessQuality,
    adjustment,
  ] = await Promise.all([
    categoryTotals("PERSONAL", fy.start, rangeEnd),
    categoryTotals("BUSINESS", fy.start, rangeEnd),
    dataQuality("PERSONAL", fy.start, rangeEnd),
    dataQuality("BUSINESS", fy.start, rangeEnd),
    getTaxYearAdjustment(fy.label),
  ]);

  return {
    fy,
    rangeEnd,
    rangeLabel: fyRangeLabel(fy, today),
    adjustment,
    rental: computeRentalFigures(personalCategories, adjustment),
    business: computeBusinessFigures(businessCategories),
    homeOffice: computeHomeOfficeFigures(personalCategories),
    taxableIncome: computeTaxableIncomeFigures(personalCategories),
    personalQuality,
    businessQuality,
  };
}

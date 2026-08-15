// Reads behind the budget screens.
//
// Kept out of the components so "what counts as spent?" lives in one place
// rather than being re-derived per page, the same split
// `src/lib/sync/status.ts` uses for the sync page.
//
// Two conventions run through all of it:
//
//   - Expenses are stored NEGATIVE (money leaving) and every figure the budget
//     shows is POSITIVE (money spent). The flip happens here, once, at the
//     boundary — not in the components, where half of them would forget.
//
//   - Only EXPENSE categories are ever budgeted. TRANSFER and OWNER are
//     excluded by the same filter, which is what keeps money moving between
//     your own accounts out of the budget without a special case anywhere.

import { prisma } from "@/lib/prisma";
import type { Book, Category } from "@/generated/prisma/client";
import {
  currentPayPeriod,
  daysOf,
  dueDateIn,
  payPeriodFor,
  previousPeriods,
  type PayPeriod,
} from "./period";
import { allowanceCents, budgetTotals, type BudgetTotals } from "./totals";
import { detectRecurring, type RecurringSuggestion } from "./recurring";

/** How many past periods the budget suggestions average over. */
export const SUGGESTION_PERIODS = 3;

/** How far back fixed-bill detection looks. Six months of cadence to judge. */
const RECURRING_PERIODS = 6;

export const DEFAULT_ANCHOR_DAY = 20;

export type BudgetSettingsView = {
  anchorDay: number;
  splitFortnightly: boolean;
};

export type CategoryBudgetView = {
  categoryId: string;
  name: string;
  book: Book;
  taxTag: string | null;
  /** Standing budget plus this period's carryover — what may be spent. */
  budgetCents: number;
  /** The standing budget on its own. */
  standingCents: number;
  carryoverCents: number;
  spentCents: number;
  isFixed: boolean;
  dueDay: number | null;
  dueDate: Date | null;
  estimated: boolean;
  paid: boolean;
  /** Average actual spend over the last three periods. */
  averageCents: number;
  /** No CategoryBudget row exists for this category at all. */
  unbudgeted: boolean;
};

export type BudgetView = {
  period: PayPeriod;
  settings: BudgetSettingsView;
  book: Book;
  /** Categories with a budget or some spending — the ones worth showing. */
  categories: CategoryBudgetView[];
  /** Every EXPENSE category, for the Setup screen. */
  allCategories: CategoryBudgetView[];
  totals: BudgetTotals;
  balanceCents: number;
  /** Income received in THIS period — partial, because the period is. */
  incomeCents: number;
  /**
   * Average income per period over the last three.
   *
   * The figure to plan against. Comparing a full period's budget to
   * `incomeCents` on day 5 would say you are 900% overcommitted, which is
   * arithmetic rather than information.
   */
  averageIncomeCents: number;
  /** Transactions this period with no category — they understate everything. */
  uncategorisedCount: number;
  /** Accounts with no book; their balances are missing from the total. */
  unassignedAccountCount: number;
  /** No budget has ever been set for this book. */
  isFirstRun: boolean;
};

/**
 * The pay-cycle settings.
 *
 * Returns defaults rather than creating a row. A read that writes would mean
 * every page load needs a writable database, and there is nothing here a
 * default can't express.
 */
export async function getBudgetSettings(): Promise<BudgetSettingsView> {
  const row = await prisma.budgetSettings.findUnique({
    where: { id: "singleton" },
  });

  return {
    anchorDay: row?.anchorDay ?? DEFAULT_ANCHOR_DAY,
    splitFortnightly: row?.splitFortnightly ?? false,
  };
}

/**
 * The period being viewed: `?period=YYYY-MM-DD` if given and valid, else now.
 *
 * An explicit date goes straight to `payPeriodFor` — it is already a calendar
 * date, so running it back through the NZ conversion would shift it.
 */
export async function resolvePeriod(
  periodStart?: string,
): Promise<{ period: PayPeriod; settings: BudgetSettingsView }> {
  const settings = await getBudgetSettings();
  const parsed = periodStart ? new Date(`${periodStart}T00:00:00Z`) : null;

  return {
    settings,
    period:
      parsed && !Number.isNaN(parsed.getTime())
        ? payPeriodFor(parsed, settings.anchorDay)
        : currentPayPeriod(settings.anchorDay),
  };
}

/** Parse `?book=`. Anything unrecognised falls back to the personal book. */
export function parseBook(value?: string): Book {
  return value === "BUSINESS" ? "BUSINESS" : "PERSONAL";
}

/**
 * Resolve each category's budget row for a period.
 *
 * A period with no rows is NOT an empty budget: each category falls back to
 * its most recent row on or before the period, so a budget continues until
 * someone changes it (see the schema comment on CategoryBudget).
 */
async function resolveBudgets(book: Book, period: PayPeriod) {
  const rows = await prisma.categoryBudget.findMany({
    where: {
      periodStart: { lte: period.start },
      category: { book, kind: "EXPENSE" },
    },
    orderBy: { periodStart: "desc" },
  });

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.categoryId)) latest.set(row.categoryId, row);
  }

  return { latest, anyRows: rows.length > 0 };
}

/** Sum actual spending per category over a date range, as positive cents. */
async function spentByCategory(
  book: Book,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const rows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      date: { gte: from, lte: to },
      category: { book, kind: "EXPENSE" },
    },
    _sum: { amountCents: true },
  });

  const spent = new Map<string, number>();
  for (const row of rows) {
    if (!row.categoryId) continue;
    spent.set(row.categoryId, -(row._sum.amountCents ?? 0));
  }
  return spent;
}

/**
 * Every EXPENSE category for a book, with its budget and actuals.
 *
 * The one place a CategoryBudget row becomes a view model. Both the overview
 * and the setup screen go through here — the overview then filters — so the
 * two can never disagree about what a category's budget is.
 */
async function categoryViews(
  book: Book,
  period: PayPeriod,
  settings: BudgetSettingsView,
): Promise<{ views: CategoryBudgetView[]; anyRows: boolean }> {
  const older = previousPeriods(period, SUGGESTION_PERIODS, settings.anchorDay);

  const [categories, budgets, spent, averageTotals] = await Promise.all([
    prisma.category.findMany({
      where: { book, kind: "EXPENSE" },
      orderBy: { name: "asc" },
    }),
    resolveBudgets(book, period),
    spentByCategory(book, period.start, period.end),
    spentByCategory(book, older[older.length - 1].start, older[0].end),
  ]);

  const views = categories.map((category) => {
    const row = budgets.latest.get(category.id);
    const spentCents = spent.get(category.id) ?? 0;

    // Carryover applies only when the row belongs to THIS period. An
    // inherited row's carryover was a one-off correction for the period it
    // was written for; re-applying it every month afterwards would compound.
    const carryoverCents =
      row && row.periodStart.getTime() === period.start.getTime()
        ? row.carryoverCents
        : 0;

    const standingCents = row?.amountCents ?? 0;
    const dueDay = row?.dueDay ?? null;

    return {
      categoryId: category.id,
      name: category.name,
      book: category.book,
      taxTag: category.taxTag,
      standingCents,
      carryoverCents,
      budgetCents: allowanceCents(standingCents, carryoverCents),
      spentCents,
      isFixed: row?.isFixed ?? false,
      dueDay,
      dueDate: dueDay ? dueDateIn(period, dueDay) : null,
      estimated: row?.estimated ?? false,
      // A bill counts as paid once anything has landed against it. The feed
      // cannot tell a part payment from a full one, and "nothing has arrived"
      // is the distinction that matters for safe-to-spend.
      paid: spentCents > 0,
      averageCents: Math.round(
        (averageTotals.get(category.id) ?? 0) / SUGGESTION_PERIODS,
      ),
      unbudgeted: !row,
    };
  });

  return { views, anyRows: budgets.anyRows };
}

/** Everything the overview needs for one book. */
export async function getBudgetView(
  book: Book,
  period: PayPeriod,
  settings: BudgetSettingsView,
): Promise<BudgetView> {
  const older = previousPeriods(period, SUGGESTION_PERIODS, settings.anchorDay);

  const [
    { views, anyRows },
    balance,
    income,
    averageIncome,
    uncategorisedCount,
    unassignedAccountCount,
  ] = await Promise.all([
    categoryViews(book, period, settings),
    prisma.account.aggregate({ _sum: { balanceCents: true }, where: { book } }),
    prisma.transaction.aggregate({
      _sum: { amountCents: true },
      where: {
        date: { gte: period.start, lte: period.end },
        category: { book, kind: "INCOME" },
      },
    }),
    prisma.transaction.aggregate({
      _sum: { amountCents: true },
      where: {
        date: { gte: older[older.length - 1].start, lte: older[0].end },
        category: { book, kind: "INCOME" },
      },
    }),
    prisma.transaction.count({
      where: {
        date: { gte: period.start, lte: period.end },
        categoryId: null,
        account: { book },
      },
    }),
    prisma.account.count({ where: { book: null } }),
  ]);

  // 63 categories exist and a given month touches a fraction of them. One with
  // neither a budget nor any spending is noise on every screen but Setup.
  const active = views.filter((v) => v.budgetCents > 0 || v.spentCents !== 0);
  const balanceCents = balance._sum.balanceCents ?? 0;

  return {
    period,
    settings,
    book,
    categories: active,
    allCategories: views,
    totals: budgetTotals(
      active.map((v) => ({
        categoryId: v.categoryId,
        name: v.name,
        budgetCents: v.budgetCents,
        spentCents: v.spentCents,
        isFixed: v.isFixed,
        paid: v.paid,
      })),
      balanceCents,
      period,
    ),
    balanceCents,
    incomeCents: income._sum.amountCents ?? 0,
    averageIncomeCents: Math.round(
      (averageIncome._sum.amountCents ?? 0) / SUGGESTION_PERIODS,
    ),
    uncategorisedCount,
    unassignedAccountCount,
    isFirstRun: !anyRows,
  };
}

/** Which categories look like recurring bills. Suggestions only — never written. */
export async function suggestFixedBills(
  book: Book,
  period: PayPeriod,
  settings: BudgetSettingsView,
): Promise<Map<string, RecurringSuggestion>> {
  const window = previousPeriods(period, RECURRING_PERIODS, settings.anchorDay);

  const transactions = await prisma.transaction.findMany({
    where: {
      date: { gte: window[window.length - 1].start, lte: period.end },
      amountCents: { lt: 0 },
      category: { book, kind: "EXPENSE" },
    },
    select: {
      categoryId: true,
      date: true,
      description: true,
      amountCents: true,
    },
  });

  const suggestions = detectRecurring(
    transactions
      .filter((t): t is typeof t & { categoryId: string } => t.categoryId !== null)
      .map((t) => ({
        categoryId: t.categoryId,
        date: t.date,
        description: t.description,
        amountCents: -t.amountCents,
      })),
  );

  return new Map(suggestions.map((s) => [s.categoryId, s]));
}

export type CategoryDetailView = {
  category: Category;
  line: CategoryBudgetView;
  period: PayPeriod;
  transactions: {
    id: string;
    date: Date;
    description: string;
    payee: string | null;
    amountCents: number;
  }[];
  /** Daily spend across the period, for the bar chart. */
  series: { label: string; cents: number; future: boolean }[];
};

/** One category's drilldown. Null when the id doesn't exist. */
export async function getCategoryDetail(
  categoryId: string,
  period: PayPeriod,
  settings: BudgetSettingsView,
): Promise<CategoryDetailView | null> {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return null;

  const [{ views }, transactions] = await Promise.all([
    categoryViews(category.book, period, settings),
    prisma.transaction.findMany({
      where: { categoryId, date: { gte: period.start, lte: period.end } },
      orderBy: { date: "desc" },
      select: {
        id: true,
        date: true,
        description: true,
        payee: true,
        amountCents: true,
      },
    }),
  ]);

  const line = views.find((v) => v.categoryId === categoryId);
  if (!line) return null;

  const byDay = new Map<number, number>();
  for (const transaction of transactions) {
    if (transaction.amountCents >= 0) continue;
    const key = transaction.date.getTime();
    byDay.set(key, (byDay.get(key) ?? 0) + -transaction.amountCents);
  }

  const todayIndex = period.dayOfPeriod - 1;

  return {
    category,
    line,
    period,
    transactions,
    series: daysOf(period).map((day, index) => ({
      label: `${day.getUTCDate()}`,
      cents: byDay.get(day.getTime()) ?? 0,
      future: index > todayIndex,
    })),
  };
}

export type ReviewLine = {
  categoryId: string;
  name: string;
  book: Book;
  budgetCents: number;
  spentCents: number;
  /** This category already has a budget row for the running period. */
  budgetedThisPeriod: boolean;
};

/** Last period's outcome, for the month-end review. */
export async function getReviewView(
  book: Book,
  period: PayPeriod,
  settings: BudgetSettingsView,
): Promise<{
  previous: PayPeriod;
  lines: ReviewLine[];
  /**
   * Last period had budgets at all.
   *
   * When it didn't — the normal case for the first month or two — every
   * category is "over" against zero, and presenting that as a review would be
   * arithmetically true and completely useless.
   */
  previousWasBudgeted: boolean;
}> {
  const [previous] = previousPeriods(period, 1, settings.anchorDay);

  const [categories, previousBudgets, spent, currentRows] = await Promise.all([
    prisma.category.findMany({
      where: { book, kind: "EXPENSE" },
      orderBy: { name: "asc" },
    }),
    resolveBudgets(book, previous),
    spentByCategory(book, previous.start, previous.end),
    prisma.categoryBudget.findMany({
      where: { periodStart: period.start, category: { book } },
      select: { categoryId: true },
    }),
  ]);

  const budgetedNow = new Set(currentRows.map((row) => row.categoryId));

  const lines = categories
    .map((category) => {
      const row = previousBudgets.latest.get(category.id);
      const carryoverCents =
        row && row.periodStart.getTime() === previous.start.getTime()
          ? row.carryoverCents
          : 0;

      return {
        categoryId: category.id,
        name: category.name,
        book: category.book,
        budgetCents: allowanceCents(row?.amountCents ?? 0, carryoverCents),
        spentCents: spent.get(category.id) ?? 0,
        budgetedThisPeriod: budgetedNow.has(category.id),
      };
    })
    // A category with no budget and no spending last period has nothing to
    // decide about.
    .filter((line) => line.budgetCents > 0 || line.spentCents !== 0);

  return {
    previous,
    lines,
    previousWasBudgeted: lines.some((line) => line.budgetCents > 0),
  };
}

export type TransactionRow = {
  id: string;
  date: Date;
  description: string;
  payee: string | null;
  amountCents: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryBook: Book | null;
  /** Total spent in this category up to and including this row. */
  runningCents: number | null;
  /** The category's budget, for the "what's left after this" annotation. */
  budgetCents: number | null;
};

/**
 * The budget-annotated transaction list.
 *
 * The annotation is the point: every row says what it did to the budget it
 * belongs to. That needs a running total per category, which is computed
 * oldest-first here and then the list is flipped for display.
 */
export async function getTransactions(
  book: Book,
  period: PayPeriod,
  settings: BudgetSettingsView,
  query?: string,
): Promise<TransactionRow[]> {
  const search = query?.trim();

  const [{ views }, rows] = await Promise.all([
    categoryViews(book, period, settings),
    prisma.transaction.findMany({
      where: {
        date: { gte: period.start, lte: period.end },
        account: { book },
        ...(search
          ? {
              OR: [
                { description: { contains: search, mode: "insensitive" as const } },
                { payee: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      include: { category: true },
    }),
  ]);

  const budgets = new Map(views.map((v) => [v.categoryId, v.budgetCents]));
  const running = new Map<string, number>();

  const annotated = rows.map((row) => {
    let runningCents: number | null = null;

    if (row.categoryId && row.amountCents < 0 && row.category?.kind === "EXPENSE") {
      const total = (running.get(row.categoryId) ?? 0) + -row.amountCents;
      running.set(row.categoryId, total);
      runningCents = total;
    }

    return {
      id: row.id,
      date: row.date,
      description: row.description,
      payee: row.payee,
      amountCents: row.amountCents,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? null,
      categoryBook: row.category?.book ?? null,
      runningCents,
      budgetCents: row.categoryId ? (budgets.get(row.categoryId) ?? null) : null,
    };
  });

  return annotated.reverse();
}

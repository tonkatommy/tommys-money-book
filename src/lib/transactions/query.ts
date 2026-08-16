// Reading the transaction list: what the filter bar means, and what it fetches.
//
// The parsing half is pure and the fetching half is a thin Prisma call, the
// same split `src/lib/budget/query.ts` and `src/lib/categories/` already use.
// That matters more here than elsewhere because the filters come from the URL,
// which is to say from anywhere: a bookmark, a hand-typed query string, a link
// from three months ago whose category no longer exists. Every one of those has
// to produce a list rather than a crash, so parsing never throws — it falls
// back and moves on.
//
// The default window is the current CALENDAR month, not the pay period. The
// budget screens are the ones that reason in pay periods; this is the ledger,
// and "what did I spend in August" is the question people arrive with. An
// absent date range is still a range — defaulting to everything would mean the
// first page load reads 2,797 rows to show 50.

import { prisma } from "@/lib/prisma";
import type { Book, Prisma } from "@/generated/prisma/client";
import { nzToday, utcDate } from "@/lib/budget/period";

/** Rows per page. */
export const PAGE_SIZE = 50;

export type TransactionFilters = {
  book: Book;
  accountId: string | null;
  categoryId: string | null;
  /** Only rows with no category. Mutually exclusive with `categoryId`. */
  uncategorised: boolean;
  /** Inclusive, UTC midnight — the shape `Transaction.date` is stored in. */
  from: Date;
  to: Date;
  /** Free text over payee and description. */
  q: string;
  /** 1-based. */
  page: number;
};

/** What the page passes in: Next's resolved `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse `YYYY-MM-DD` into a UTC-midnight Date.
 *
 * Returns null for anything else — including "2026-02-31", which `Date` would
 * happily roll forward into March. A filter that silently means a different
 * day than the one written in the URL is worse than a filter that is ignored.
 */
export function parseDateParam(raw: string | undefined): Date | null {
  const value = (raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = utcDate(Number(year), Number(month) - 1, Number(day));

  return date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
    ? date
    : null;
}

/** First and last day of the calendar month containing `today`, in NZ terms. */
export function currentMonth(today: Date = nzToday()): { from: Date; to: Date } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  return {
    from: utcDate(year, month, 1),
    // Day 0 of the next month is the last day of this one, and it handles
    // February without a leap-year branch.
    to: utcDate(year, month + 1, 0),
  };
}

/**
 * Turn a query string into filters.
 *
 * Pure, total, and never throws. Every malformed value falls back to the
 * default for that field rather than rejecting the whole request — a stale
 * bookmark with a deleted category id should show the month, not an error.
 */
export function parseTransactionFilters(
  params: RawSearchParams,
  today: Date = nzToday(),
): TransactionFilters {
  const month = currentMonth(today);

  const from = parseDateParam(first(params.from)) ?? month.from;
  const to = parseDateParam(first(params.to)) ?? month.to;

  const pageRaw = Number.parseInt(first(params.page) ?? "", 10);
  const uncategorised = first(params.uncategorised) === "1";

  return {
    book: first(params.book) === "BUSINESS" ? "BUSINESS" : "PERSONAL",
    accountId: first(params.account)?.trim() || null,
    // "Uncategorised" wins over a category id. Both together describe an empty
    // set, and answering a contradictory filter with zero rows looks like a
    // bug in the data rather than in the URL.
    categoryId: uncategorised ? null : first(params.category)?.trim() || null,
    uncategorised,
    // Swapped rather than rejected: someone dragging a date range backwards
    // meant the range, not an error.
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    q: (first(params.q) ?? "").trim(),
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  };
}

/** Everything a link has to carry that isn't a filter. */
export type QueryContext = {
  /**
   * Leave `from`/`to` out of the URL.
   *
   * Set when the dates in `filters` came from the pay period rather than from
   * the reader. Emitting them would make the NEXT request see `?from`/`?to`
   * and conclude a custom range was chosen — which silently drops the budget
   * annotation and shows the "custom date range" notice, just from clicking
   * Next. The absence of the parameters is what means "the period".
   */
  omitDates?: boolean;
  /** `?period=` if the reader is looking at a period other than the current one. */
  period?: string;
};

/**
 * Rebuild a query string from filters.
 *
 * One function for pagination links, the filter form's hidden fields and the
 * post-mutation redirect, so a filtered view survives every one of them. Empty
 * and default values are omitted, which keeps the common URL short enough to
 * read.
 *
 * Every link on the screen goes through here, so anything this drops is
 * silently dropped by paging, by "show only those", and by every filter
 * change — which is why `period` is threaded through rather than left to the
 * caller to remember.
 */
export function filtersToQuery(
  filters: TransactionFilters,
  overrides: Partial<TransactionFilters> = {},
  context: QueryContext = {},
): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  const iso = (date: Date): string => date.toISOString().slice(0, 10);

  if (merged.book === "BUSINESS") params.set("book", "BUSINESS");
  if (context.period) params.set("period", context.period);
  if (merged.accountId) params.set("account", merged.accountId);
  if (merged.categoryId) params.set("category", merged.categoryId);
  if (merged.uncategorised) params.set("uncategorised", "1");
  if (merged.q) params.set("q", merged.q);
  if (!context.omitDates) {
    params.set("from", iso(merged.from));
    params.set("to", iso(merged.to));
  }
  if (merged.page > 1) params.set("page", String(merged.page));

  return params.toString();
}

/** The Prisma `where` for a set of filters. Shared by the page and the count. */
function whereFor(filters: TransactionFilters): Prisma.TransactionWhereInput {
  return {
    date: { gte: filters.from, lte: filters.to },
    account: { book: filters.book },
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.uncategorised ? { categoryId: null } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.q
      ? {
          OR: [
            { description: { contains: filters.q, mode: "insensitive" as const } },
            { payee: { contains: filters.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

export type ListRow = {
  id: string;
  date: Date;
  description: string;
  payee: string | null;
  amountCents: number;
  notes: string | null;
  source: "AKAHU" | "MANUAL";
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryBook: Book | null;
  /** Part of a confirmed transfer pair — neither income nor expense. */
  transferPairId: string | null;
};

export type TransactionPage = {
  rows: ListRow[];
  total: number;
  page: number;
  pageCount: number;
  /** How many of the matched rows have no category, across all pages. */
  uncategorisedTotal: number;
};

/**
 * One page of the filtered list.
 *
 * The count is a separate query rather than `rows.length` because the point of
 * pagination is not loading the other 2,747 rows. `uncategorisedTotal` is
 * counted across the whole filter, not the page, so the "N need a category"
 * prompt doesn't change meaning when you turn to page two.
 */
export async function queryTransactions(
  filters: TransactionFilters,
): Promise<TransactionPage> {
  const where = whereFor(filters);

  const [total, uncategorisedTotal] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.count({ where: { ...where, categoryId: null } }),
  ]);

  // Clamped, so a stale `?page=99` shows the last page rather than an empty
  // list captioned "Page 99 of 3". The counts have to be resolved before the
  // rows to do it, which costs a round trip and buys never rendering a page
  // that says there are results and then shows none.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), pageCount);

  const rows = await prisma.transaction.findMany({
    where,
    // `id` breaks the tie so paging is stable: `date` alone is a bare date
    // with dozens of rows sharing a value, and an unstable sort can show the
    // same transaction on two pages and skip another entirely.
    orderBy: [{ date: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      date: true,
      description: true,
      payee: true,
      amountCents: true,
      notes: true,
      source: true,
      transferPairId: true,
      account: { select: { name: true } },
      category: { select: { id: true, name: true, book: true } },
    },
  });

  return {
    rows: rows.map((row) => ({
      id: row.id,
      date: row.date,
      description: row.description,
      payee: row.payee,
      amountCents: row.amountCents,
      notes: row.notes,
      source: row.source,
      accountName: row.account.name,
      categoryId: row.category?.id ?? null,
      categoryName: row.category?.name ?? null,
      categoryBook: row.category?.book ?? null,
      transferPairId: row.transferPairId,
    })),
    total,
    // The clamped page, not the requested one — the pager renders this, so an
    // out-of-range request has to report where it actually landed.
    page,
    pageCount,
    uncategorisedTotal,
  };
}

/** The accounts and categories the filter bar's dropdowns offer. */
export async function getFilterOptions(book: Book): Promise<{
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string }[];
}> {
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({
      where: { book },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { book },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true },
    }),
  ]);

  return { accounts, categories };
}

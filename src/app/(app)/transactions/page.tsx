// Transactions, but every row says what it did to your budget.
//
// That annotation is the whole reason this screen differs from a plain ledger:
// "$87.32" tells you nothing you didn't know at the till, whereas "$108.60
// left in Groceries" is the sentence that changes what you do next.
//
// Phase 3a layers the management features on top: filters, pagination, bulk
// categorise, and a link into each row's detail.
//
// TWO THINGS THE TWO SPECS DISAGREED ABOUT, and how they're settled here.
//
// 1. The default window. The 3a spec (§3a) defaults to the calendar month; the
//    3b screen is scoped to the pay period, which is what the header, the nav
//    and every budget figure in the app already reason in. The pay period wins
//    as the DEFAULT, and an explicit ?from/?to overrides it — so "what did I
//    spend this period" needs no filter and "every power bill last year" is
//    still one URL away.
//
// 2. The annotation. 3b showed a running total per category up to each row,
//    which cannot survive pagination: on page two the earlier rows aren't
//    loaded, so the running total would silently restart. The annotation is
//    therefore the category's REMAINING budget for the period — the same
//    figure for every row of a category, correct on every page, and still the
//    sentence that changes what you do next. It is shown only when the window
//    is the pay period, because "left in Groceries" is meaningless against an
//    arbitrary date range.
//
// Layout follows the Money Book canvas (Tx.dc.html): one row component that
// stacks on a phone (grouped under day headers) and spreads into columns on
// a desktop. Every row says who decided its category.

import Link from "next/link";
import { Fragment } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, Button, CalendarChip, EmptyState, Icon, Provenance } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { formatNZD } from "@/lib/money";
import { dateRange, nzDate } from "@/lib/budget/period";
import { getBudgetView, resolvePeriod } from "@/lib/budget/query";
import {
  bookAgnosticQuery,
  filtersToQuery,
  getFilterOptions,
  parseTransactionFilters,
  queryTransactions,
  type RawSearchParams,
  type TransactionFilters,
} from "@/lib/transactions/query";
import { BulkForm } from "./bulk";

export const dynamic = "force-dynamic";

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const dayHeading = new Intl.DateTimeFormat("en-NZ", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const periodParam =
    typeof params.period === "string" ? params.period : undefined;
  const { period, settings } = await resolvePeriod(periodParam);

  // The period is the default window, so it is passed in as the fallback the
  // parser uses when ?from/?to are absent.
  const parsed = parseTransactionFilters(params);
  const usingPeriod = !params.from && !params.to;
  const filters: TransactionFilters = usingPeriod
    ? { ...parsed, from: period.start, to: period.end }
    : parsed;

  const [page, options, view] = await Promise.all([
    queryTransactions(filters),
    getFilterOptions(filters.book),
    // Only needed for the annotation, and only when the window is the period.
    usingPeriod ? getBudgetView(filters.book, period, settings) : null,
  ]);

  // categoryId → what's left of its budget this period.
  const leftByCategory = new Map<string, { name: string; leftCents: number; budgeted: boolean }>(
    (view?.categories ?? []).map((category) => [
      category.categoryId,
      {
        name: category.name,
        leftCents: category.budgetCents - category.spentCents,
        budgeted: category.budgetCents > 0,
      },
    ]),
  );

  const expenseCategories = options.categories.filter(
    (category) => category.kind === "EXPENSE",
  );
  // Every link on this screen goes through here. The context is what stops a
  // link quietly changing the view it links from: `omitDates` keeps the
  // period-derived dates out of the URL, so clicking Next doesn't read back as
  // "custom range chosen" and drop the budget annotation, and `period` keeps a
  // reader who is looking at an earlier period from being returned to this one.
  const query = (overrides: Partial<TransactionFilters>): string =>
    `/transactions?${filtersToQuery(filters, overrides, {
      omitDates: usingPeriod,
      period: periodParam,
    })}`;

  const bookName = filters.book === "BUSINESS" ? "Business" : "Personal";
  const filtered = Boolean(filters.q || filters.accountId || filters.categoryId || filters.uncategorised);

  return (
    <AppShell
      active="transactions"
      book={filters.book}
      period={period}
      basePath="/transactions"
      preserveQuery={bookAgnosticQuery(filters, {
        omitDates: usingPeriod,
        period: periodParam,
      })}
      splitFortnightly={settings.splitFortnightly}
    >
      {page.uncategorisedTotal > 0 && !filters.uncategorised && (
        <Alert
          title={`${page.uncategorisedTotal} transaction${page.uncategorisedTotal === 1 ? " needs" : "s need"} a category`}
          affects="Understates: every budget figure they belong to"
          actions={
            <Link className="btn sm" href={query({ uncategorised: true, page: 1 })}>
              Show only these
            </Link>
          }
        >
          {page.uncategorisedTotal === 1 ? "It isn't" : "They aren't"} counted in
          any budget yet.
        </Alert>
      )}

      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Transactions</h1>
          <span className="t-s ink2">
            {bookName} book · {page.total} transaction{page.total === 1 ? "" : "s"}
          </span>
        </div>
        <div className="row wrap">
          {usingPeriod ? (
            <CalendarChip kind="pp" label="Pay period">
              {dateRange(period.start, period.end)}
            </CalendarChip>
          ) : (
            <span className="cal mo">
              <Icon name="cal" size="sm" />
              {dateRange(filters.from, filters.to)}
            </span>
          )}
          <Link className="btn primary" href={withBook("/transactions/new", filters.book)}>
            <Icon name="plus" size="sm" />
            Add cash entry
          </Link>
        </div>
      </div>

      {/* A GET form: filters live entirely in the query string, so the page
          is bookmarkable and the back button works. */}
      <form className="filters" method="get" action="/transactions">
        {filters.book === "BUSINESS" && <input type="hidden" name="book" value="BUSINESS" />}
        {/* A GET form submits only its own fields, so anything not
            represented here is dropped on Apply. The period is not a filter
            and has no control, but losing it would return a reader looking at
            July to the current period the moment they typed a search. */}
        {periodParam && <input type="hidden" name="period" value={periodParam} />}

        <label className="inp-search">
          <Icon name="search" />
          <span className="vh">Search</span>
          <input
            className="inp"
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search payee or description"
          />
        </label>
        <label style={{ flex: "1 1 170px", maxWidth: 220 }}>
          <span className="vh">Account</span>
          <select className="inp" name="account" defaultValue={filters.accountId ?? ""} style={{ width: "100%" }}>
            <option value="">All accounts</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 170px", maxWidth: 220 }}>
          <span className="vh">Category</span>
          <select className="inp" name="category" defaultValue={filters.categoryId ?? ""} style={{ width: "100%" }}>
            <option value="">All categories</option>
            {options.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 6, flex: "1 1 150px", maxWidth: 200 }}>
          <span className="t-xs ink3">From</span>
          <input
            className="inp"
            type="date"
            name="from"
            defaultValue={usingPeriod ? "" : iso(filters.from)}
            style={{ width: "100%" }}
          />
        </label>
        <label className="row" style={{ gap: 6, flex: "1 1 150px", maxWidth: 200 }}>
          <span className="t-xs ink3">To</span>
          <input
            className="inp"
            type="date"
            name="to"
            defaultValue={usingPeriod ? "" : iso(filters.to)}
            style={{ width: "100%" }}
          />
        </label>
        <label className="fchip">
          <input type="checkbox" name="uncategorised" value="1" defaultChecked={filters.uncategorised} />
          Needs a category
          {page.uncategorisedTotal > 0 ? ` · ${page.uncategorisedTotal}` : ""}
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {(filtered || !usingPeriod) && (
          <Link className="btn ghost" href={withBook("/transactions", filters.book)}>
            Clear
          </Link>
        )}
      </form>

      {!usingPeriod && (
        <p className="t-xs ink3">
          A custom date range, so the budget effect column is hidden: &ldquo;left
          in Groceries&rdquo; only means something against a pay period.
        </p>
      )}

      {page.rows.length === 0 ? (
        <EmptyState
          icon={filters.uncategorised ? "check" : "search"}
          title={
            filters.uncategorised
              ? "Everything here is categorised"
              : filters.q
                ? `Nothing matches “${filters.q}”`
                : "No transactions in this window"
          }
          body={
            filters.uncategorised
              ? "Every transaction matching these filters has a category, so the budget figures are complete."
              : `Nothing between ${nzDate(filters.from)} and ${nzDate(filters.to)}${
                  filtered ? " with these filters" : ""
                }. If you expected something, check Sync status: a stopped sync looks just like a quiet day.`
          }
          action={
            <div className="row wrap" style={{ justifyContent: "center", gap: 10 }}>
              {filtered && (
                <Link className="btn" href={withBook("/transactions", filters.book)}>
                  Clear filters
                </Link>
              )}
              <Link className="btn ghost" href="/sync">
                Check Sync status
              </Link>
            </div>
          }
        />
      ) : (
        <BulkForm categories={expenseCategories}>
          <div className="txl">
            <div className="txh">
              <span />
              <span>Date</span>
              <span>Description</span>
              <span>Account</span>
              <span>Category · decided by</span>
              <span>{usingPeriod ? "Effect on budget" : ""}</span>
              <span className="r">Amount</span>
            </div>
            {page.rows.map((row, i) => {
              const left = row.categoryId ? leftByCategory.get(row.categoryId) : undefined;
              const newDay = i === 0 || row.date.getTime() !== page.rows[i - 1].date.getTime();
              const income = row.amountCents > 0;
              const name = row.payee ?? row.description;

              return (
                <Fragment key={row.id}>
                  {newDay && <div className="dayh">{dayHeading.format(row.date)}</div>}
                  <div className="tx">
                    <span className="c-sel">
                      <input type="checkbox" name="ids" value={row.id} aria-label={`Select ${name}`} />
                    </span>
                    <span className="c-date">{nzDate(row.date)}</span>
                    <span className="c-desc">
                      <Link className="d1" href={`/transactions/${row.id}`}>
                        {name}
                      </Link>
                      {(row.source === "MANUAL" || row.transferPairId) && (
                        <span className="d2">
                          {row.source === "MANUAL" && (
                            <span className="badge b-cash">
                              <Icon name="cash" />
                              Cash
                            </span>
                          )}
                          {row.transferPairId && (
                            <span className="badge b-xfer">
                              <Icon name="swap" />
                              Transfer
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="c-acct">{row.accountName}</span>
                    <span className="c-cat">
                      {row.categoryId && row.categoryName ? (
                        <>
                          <span className="mb-truncate">{row.categoryName}</span>
                          <Provenance source={row.categorySource} short />
                        </>
                      ) : (
                        <span className="badge b-need">
                          <Icon name="warn" />
                          Needs a category
                        </span>
                      )}
                    </span>
                    <span className="c-eff">
                      {!usingPeriod
                        ? ""
                        : left?.budgeted
                          ? left.leftCents < 0
                            ? `${formatNZD(Math.abs(left.leftCents))} over in ${left.name}`
                            : `${formatNZD(left.leftCents)} left in ${left.name}`
                          : !row.categoryId
                            ? "Not in any budget yet"
                            : income
                              ? "Income · not budgeted"
                              : row.transferPairId
                                ? "Transfer · nets to zero"
                                : "No budget for this category"}
                    </span>
                    <span className={income ? "c-amt m in" : "c-amt m"}>
                      {income ? "+" : ""}
                      {formatNZD(Math.abs(row.amountCents))}
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </BulkForm>
      )}

      <div className="row between wrap t-xs ink3">
        <span>
          Page {page.page} of {Math.max(1, page.pageCount)} · {page.total} transactions.
          Nothing here can be deleted: correct a category instead.
        </span>
        {page.pageCount > 1 && (
          <span className="row" style={{ gap: 10 }}>
            {page.page > 1 && (
              <Link className="btn sm" href={query({ page: page.page - 1 })}>
                <Icon name="back" size="sm" />
                Previous
              </Link>
            )}
            {page.page < page.pageCount && (
              <Link className="btn sm" href={query({ page: page.page + 1 })}>
                Next
                <Icon name="chev" size="sm" />
              </Link>
            )}
          </span>
        )}
      </div>
    </AppShell>
  );
}

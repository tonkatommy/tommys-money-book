// Transactions, but every row says what it did to your budget.
//
// That annotation is the whole reason this screen differs from a plain ledger:
// "-$87.32" tells you nothing you didn't know at the till, whereas "$108.60
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

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CategoryTag,
  EmptyState,
} from "@/components/ui/primitives";
import { ScreenHead } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { getBudgetView, resolvePeriod } from "@/lib/budget/query";
import {
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
  const leftByCategory = new Map<string, { name: string; leftCents: number }>(
    (view?.categories ?? []).map((category) => [
      category.categoryId,
      {
        name: category.name,
        leftCents: category.budgetCents - category.spentCents,
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

  return (
    <AppShell
      active="transactions"
      book={filters.book}
      period={period}
      basePath="/transactions"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Transactions"
          sub={
            usingPeriod
              ? `${page.total} in this period · ${period.label}`
              : `${page.total} between ${nzDate(filters.from)} and ${nzDate(filters.to)}`
          }
          right={
            <ButtonLink
              href={withBook("/transactions/new", filters.book)}
              variant="primary"
              size="sm"
            >
              Add cash entry
            </ButtonLink>
          }
        />

        {/* A GET form: filters live entirely in the query string, so the page
            is bookmarkable and the back button works. */}
        <Card title="Filter">
          <form className="ds-filtergrid" method="get" action="/transactions">
            {filters.book === "BUSINESS" && (
              <input type="hidden" name="book" value="BUSINESS" />
            )}

            {/* A GET form submits only its own fields, so anything not
                represented here is dropped on Apply. The period is not a filter
                and has no control, but losing it would return a reader looking
                at July to the current period the moment they typed a search. */}
            {periodParam && (
              <input type="hidden" name="period" value={periodParam} />
            )}

            <label>
              <span className="mb-field-label">Search</span>
              <input
                className="mb-input"
                type="search"
                name="q"
                defaultValue={filters.q}
                placeholder="Payee or description"
              />
            </label>

            <label>
              <span className="mb-field-label">Account</span>
              <select className="mb-input" name="account" defaultValue={filters.accountId ?? ""}>
                <option value="">All accounts</option>
                {options.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-field-label">Category</span>
              <select className="mb-input" name="category" defaultValue={filters.categoryId ?? ""}>
                <option value="">All categories</option>
                {options.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-field-label">From</span>
              <input
                className="mb-input"
                type="date"
                name="from"
                defaultValue={usingPeriod ? "" : iso(filters.from)}
              />
            </label>

            <label>
              <span className="mb-field-label">To</span>
              <input
                className="mb-input"
                type="date"
                name="to"
                defaultValue={usingPeriod ? "" : iso(filters.to)}
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
              <label className="mb-switch">
                <input
                  type="checkbox"
                  name="uncategorised"
                  value="1"
                  defaultChecked={filters.uncategorised}
                />
                <span className="mb-switch-track" aria-hidden="true" />
                <span className="mb-switch-label">Needs a category</span>
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Apply
              </Button>
            </div>
          </form>

          {!usingPeriod && (
            <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Showing a custom date range, so the budget figures below are
              hidden — &ldquo;left in Groceries&rdquo; only means something
              against a pay period.{" "}
              <Link href={withBook("/transactions", filters.book)}>
                Back to {period.label}
              </Link>
            </p>
          )}
        </Card>

        {page.uncategorisedTotal > 0 && !filters.uncategorised && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                <Badge tone="warning">{page.uncategorisedTotal}</Badge>{" "}
                {page.uncategorisedTotal === 1 ? "transaction has" : "transactions have"}{" "}
                no category, so {page.uncategorisedTotal === 1 ? "it is" : "they are"}{" "}
                missing from every budget figure.
              </span>
              <Link href={query({ uncategorised: true, page: 1 })} style={{ fontSize: "var(--text-sm)" }}>
                Show only those →
              </Link>
            </div>
          </Card>
        )}

        <Card padded={false}>
          <BulkForm categories={expenseCategories}>
            <div className="mb-rows" style={{ padding: "var(--space-2) var(--space-6) 0" }}>
              {page.rows.map((row) => {
                const left = row.categoryId ? leftByCategory.get(row.categoryId) : undefined;

                return (
                  <div key={row.id} className="mb-row mb-txn-pick">
                    <input
                      type="checkbox"
                      name="ids"
                      value={row.id}
                      aria-label={`Select ${row.payee ?? row.description}`}
                    />

                    <div style={{ minWidth: 0 }}>
                      <Link href={`/transactions/${row.id}`} className="mb-truncate" style={{ display: "block", fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                        {row.payee ?? row.description}
                      </Link>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                        <span className="mb-num" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                          {nzDate(row.date)}
                        </span>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                          {row.accountName}
                        </span>
                        {row.source === "MANUAL" && <Badge tone="neutral">cash</Badge>}
                        {row.transferPairId && <Badge tone="neutral">transfer</Badge>}
                        {row.categoryId && row.categoryName ? (
                          <Link href={withBook(`/budget/category/${row.categoryId}`, filters.book)}>
                            <CategoryTag name={row.categoryName} book={row.categoryBook} />
                          </Link>
                        ) : (
                          <Badge tone="warning">Needs a category</Badge>
                        )}
                      </div>
                    </div>

                    <div className="mb-txn-mid">
                      {left ? (
                        <span style={{ fontSize: "var(--text-xs)", color: left.leftCents < 0 ? "var(--status-error)" : "var(--text-tertiary)" }}>
                          {left.leftCents < 0
                            ? `${formatNZD(Math.abs(left.leftCents))} over`
                            : `${formatNZD(left.leftCents)} left`}{" "}
                          in {left.name}
                        </span>
                      ) : (
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                          {row.amountCents > 0 ? "Money in — not budgeted spending" : "Outside the budget"}
                        </span>
                      )}
                    </div>

                    <span className="mb-num" style={{ fontSize: "var(--text-sm)", textAlign: "right", whiteSpace: "nowrap", color: row.amountCents > 0 ? "var(--money-in)" : "var(--text-primary)" }}>
                      {formatNZD(row.amountCents)}
                    </span>
                  </div>
                );
              })}

              {page.rows.length === 0 && (
                <EmptyState
                  icon={filters.uncategorised ? "✓" : "—"}
                  title={
                    filters.uncategorised
                      ? "Everything here is categorised"
                      : filters.q
                        ? "Nothing matches that search"
                        : "No transactions in this window"
                  }
                  body={
                    filters.uncategorised
                      ? "Every transaction matching these filters has a category, so the budget figures are complete."
                      : filters.q
                        ? "Try a shorter search, or clear it to see the whole window."
                        : "Widen the dates, clear the filters, or run a sync."
                  }
                />
              )}
            </div>
          </BulkForm>
        </Card>

        {page.pageCount > 1 && (
          <div className="ds-pager">
            <span>
              Page {page.page} of {page.pageCount} · {page.total} transactions
            </span>
            <span style={{ display: "flex", gap: "var(--space-3)" }}>
              {page.page > 1 && <Link href={query({ page: page.page - 1 })}>← Previous</Link>}
              {page.page < page.pageCount && <Link href={query({ page: page.page + 1 })}>Next →</Link>}
            </span>
          </div>
        )}
      </div>
    </AppShell>
  );
}

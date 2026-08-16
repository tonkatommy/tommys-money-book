// Transactions, but every row says what it did to your budget.
//
// That annotation is the whole reason this screen differs from a plain ledger:
// "-$87.32" tells you nothing you didn't know at the till, whereas "$108.60
// left in Groceries" is the sentence that changes what you do next.
//
// The fuller management list from the Phase 3a spec — filters, bulk
// categorise, row detail, manual entry — lands on top of this later. Search
// and the uncategorised filter are here now because a budget page that points
// at "N transactions need a category" has to point somewhere useful.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  Badge,
  Card,
  CategoryTag,
  EmptyState,
} from "@/components/ui/primitives";
import { PaceBar, ScreenHead } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { getTransactions, parseBook, resolvePeriod } from "@/lib/budget/query";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    book?: string;
    period?: string;
    q?: string;
    uncategorised?: string;
  }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod(params.period);
  const onlyUncategorised = params.uncategorised === "1";
  const query = params.q?.trim() ?? "";

  const all = await getTransactions(book, period, settings, query);
  const rows = onlyUncategorised ? all.filter((row) => !row.categoryId) : all;
  const uncategorisedCount = all.filter((row) => !row.categoryId).length;

  return (
    <AppShell
      active="transactions"
      book={book}
      period={period}
      basePath="/transactions"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Transactions"
          sub={`${all.length} in this period · ${period.label}`}
          right={
            // A GET form, so the filter lives in the URL and the back button
            // works — the same reasoning the Phase 3a spec applied.
            <form className="ds-filterbar" method="get" action="/transactions">
              {book === "BUSINESS" && (
                <input type="hidden" name="book" value="BUSINESS" />
              )}
              <div className="ds-filterbar-search">
                <input
                  className="mb-input"
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Search payee or description"
                  aria-label="Search transactions"
                />
              </div>
              <div className="ds-filterbar-controls">
                <label className="mb-switch">
                  <input
                    type="checkbox"
                    name="uncategorised"
                    value="1"
                    defaultChecked={onlyUncategorised}
                  />
                  <span className="mb-switch-track" aria-hidden="true" />
                  <span className="mb-switch-label">Needs a category</span>
                </label>
                <button className="mb-btn mb-input" type="submit" style={{ width: "auto" }}>
                  Apply
                </button>
              </div>
            </form>
          }
        />

        {uncategorisedCount > 0 && !onlyUncategorised && (
          <Card>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                <Badge tone="warning">{uncategorisedCount}</Badge>{" "}
                {uncategorisedCount === 1 ? "transaction has" : "transactions have"}{" "}
                no category, so {uncategorisedCount === 1 ? "it is" : "they are"}{" "}
                missing from every budget figure.
              </span>
              <Link
                href={withBook("/transactions?uncategorised=1", book)}
                style={{ fontSize: "var(--text-sm)" }}
              >
                Show only those →
              </Link>
            </div>
          </Card>
        )}

        <Card padded={false}>
          <div className="mb-rows" style={{ paddingTop: "var(--space-2)" }}>
            {rows.map((row) => {
              const leftCents =
                row.budgetCents !== null && row.runningCents !== null
                  ? row.budgetCents - row.runningCents
                  : null;

              return (
                <div key={row.id} className="mb-row mb-txn">
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="mb-truncate"
                      style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {row.payee ?? row.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 5,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        className="mb-num"
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {nzDate(row.date)}
                      </span>
                      {row.categoryId && row.categoryName ? (
                        <Link
                          href={withBook(
                            `/budget/category/${row.categoryId}`,
                            book,
                          )}
                        >
                          <CategoryTag
                            name={row.categoryName}
                            book={row.categoryBook}
                          />
                        </Link>
                      ) : (
                        <Badge tone="warning">Needs a category</Badge>
                      )}
                    </div>

                    {/* Below 900px the middle column is hidden, so the budget
                        impact folds under the description instead of being
                        dropped — it is the point of the screen. */}
                    {leftCents !== null && (
                      <div
                        className="mb-narrow-only"
                        style={{
                          fontSize: "var(--text-xs)",
                          marginTop: 6,
                          color:
                            leftCents < 0
                              ? "var(--status-error)"
                              : "var(--text-tertiary)",
                        }}
                      >
                        {leftCents < 0
                          ? `${formatNZD(Math.abs(leftCents))} over`
                          : `${formatNZD(leftCents)} left`}{" "}
                        in {row.categoryName}
                      </div>
                    )}
                  </div>

                  <div className="mb-txn-mid">
                    {leftCents !== null && row.runningCents !== null ? (
                      <>
                        <div
                          className="mb-truncate"
                          style={{
                            fontSize: "var(--text-xs)",
                            marginBottom: 5,
                            color:
                              leftCents < 0
                                ? "var(--status-error)"
                                : "var(--text-tertiary)",
                          }}
                        >
                          {leftCents < 0
                            ? `${formatNZD(Math.abs(leftCents))} over`
                            : `${formatNZD(leftCents)} left`}{" "}
                          in {row.categoryName}
                        </div>
                        <PaceBar
                          spentCents={row.runningCents}
                          budgetCents={row.budgetCents ?? 0}
                        />
                      </>
                    ) : (
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {row.amountCents > 0
                          ? "Money in — not budgeted spending"
                          : "Outside the budget"}
                      </span>
                    )}
                  </div>

                  <span
                    className="mb-num"
                    style={{
                      fontSize: "var(--text-sm)",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      color:
                        row.amountCents > 0
                          ? "var(--money-in)"
                          : "var(--text-primary)",
                    }}
                  >
                    {formatNZD(row.amountCents)}
                  </span>
                </div>
              );
            })}

            {rows.length === 0 && (
              <EmptyState
                icon={onlyUncategorised ? "✓" : "—"}
                title={
                  onlyUncategorised
                    ? "Everything is categorised"
                    : query
                      ? "Nothing matches that search"
                      : "No transactions this period"
                }
                body={
                  onlyUncategorised
                    ? "Every transaction this period has a category, so the budget figures are complete."
                    : query
                      ? "Try a shorter search, or clear it to see the whole period."
                      : "Once a sync runs, transactions for this period will appear here."
                }
              />
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

// One category, in detail.
//
// Two shapes, because a category has two meanings. A flexible one gets pace
// figures and a "should be at today" mark. A fixed bill gets a due date and a
// paid/unpaid state, and none of the pace furniture — the question for a bill
// is "has it landed?", not "am I going too fast?".

import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
} from "@/components/ui/primitives";
import { DayBars, Figure, PaceBar, ScreenHead, Verdict } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { nzDate, shortDate } from "@/lib/budget/period";
import { getCategoryDetail, resolvePeriod } from "@/lib/budget/query";

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ book?: string; period?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { period, settings } = await resolvePeriod(query.period);

  const detail = await getCategoryDetail(id, period, settings);
  if (!detail) notFound();

  const { category, line, transactions, series } = detail;

  // The category's own book, never `?book=`. A category id already determines
  // its book, so a querystring that disagrees is either a stale link or a
  // typo — and honouring it would wrap a personal category in the business
  // shell, with the heading below saying "Personal book" inside it and every
  // nav link sending you into the wrong ledger.
  const book = category.book;

  const leftCents = line.budgetCents - line.spentCents;
  const over = leftCents < 0;
  const expectedCents = Math.round(line.budgetCents * period.elapsed);
  const projectedCents =
    period.dayOfPeriod > 1
      ? Math.round((line.spentCents / period.dayOfPeriod) * period.daysInPeriod)
      : line.budgetCents;

  return (
    <AppShell
      active="budget"
      book={book}
      period={period}
      basePath={`/budget/category/${id}`}
      splitFortnightly={settings.splitFortnightly}
      lockBook
    >
      <div className="mb-stack">
        <ScreenHead
          title={category.name}
          sub={`${category.book === "BUSINESS" ? "Business" : "Personal"} book · ${
            period.label
          }${
            category.taxTag
              ? ` · ${category.taxTag.replace(/_/g, " ").toLowerCase()}`
              : ""
          }`}
          right={
            <>
              <ButtonLink
                href={withBook("/budget", book)}
                variant="ghost"
                size="sm"
              >
                Back
              </ButtonLink>
              <ButtonLink
                href={withBook("/budget/setup", book)}
                variant="secondary"
                size="sm"
              >
                Change budget
              </ButtonLink>
            </>
          }
        />

        <Card>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: "var(--space-4)",
            }}
          >
            <div>
              <div
                className="mb-figure-md"
                style={{
                  color: over ? "var(--status-error)" : "var(--text-primary)",
                }}
              >
                {formatNZD(Math.abs(leftCents))}
              </div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-tertiary)",
                  marginTop: 2,
                }}
              >
                {over ? "over budget" : "left"} of{" "}
                {formatNZDWhole(line.budgetCents)}
                {!line.isFixed && (
                  <>
                    {" "}
                    ·{" "}
                    {formatNZD(
                      Math.round(
                        Math.max(0, leftCents) / Math.max(1, period.daysLeft),
                      ),
                    )}{" "}
                    a day for {Math.max(1, period.daysLeft)} days
                  </>
                )}
              </div>
            </div>

            {line.isFixed ? (
              <Badge tone={line.paid ? "ok" : "warning"}>
                {line.paid ? "paid this period" : "not yet paid"}
              </Badge>
            ) : (
              <Verdict deltaCents={expectedCents - line.spentCents} size="lg" />
            )}
          </div>

          <PaceBar
            spentCents={line.spentCents}
            budgetCents={line.budgetCents}
            markerPct={line.isFixed ? null : period.elapsed * 100}
          />

          <div
            className="mb-grid-4"
            style={{
              marginTop: "var(--space-6)",
              paddingTop: "var(--space-5)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <Figure label="Spent so far" value={formatNZD(line.spentCents)} />

            {line.isFixed ? (
              <>
                <Figure
                  label="Due"
                  value={line.dueDate ? shortDate(line.dueDate) : "—"}
                  note={line.estimated ? "amount varies" : undefined}
                />
                <Figure
                  label="Budgeted"
                  value={formatNZDWhole(line.budgetCents)}
                />
              </>
            ) : (
              <>
                <Figure
                  label="Should be at today"
                  value={formatNZD(expectedCents)}
                />
                <Figure label="Heading for" value={formatNZD(projectedCents)} />
              </>
            )}

            <Figure
              label="Usual for this category"
              value={formatNZD(line.averageCents)}
              note="3-period average"
            />
          </div>

          {line.carryoverCents !== 0 && (
            <p
              style={{
                margin: "var(--space-4) 0 0",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
              }}
            >
              Includes {formatNZD(Math.abs(line.carryoverCents))}{" "}
              {line.carryoverCents > 0 ? "carried over from" : "being repaid from"}{" "}
              last period, on top of a standing budget of{" "}
              {formatNZDWhole(line.standingCents)}.
            </p>
          )}
        </Card>

        <div className="mb-grid mb-grid-split">
          <Card
            title="Day by day"
            action={
              <span
                style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
              >
                {period.label}
              </span>
            }
          >
            <DayBars series={series} />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
              }}
            >
              <span>{shortDate(period.start)}</span>
              <span>today</span>
              <span>{shortDate(period.end)}</span>
            </div>
          </Card>

          <Card title={`Transactions (${transactions.length})`} padded={false}>
            <div className="mb-rows">
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="mb-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "11px 0",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="mb-truncate"
                      style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {transaction.payee ?? transaction.description}
                    </div>
                    <div
                      className="mb-num"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {nzDate(transaction.date)}
                    </div>
                  </div>
                  <span
                    className="mb-num"
                    style={{
                      fontSize: "var(--text-sm)",
                      whiteSpace: "nowrap",
                      color:
                        transaction.amountCents > 0
                          ? "var(--money-in)"
                          : "var(--money-out)",
                    }}
                  >
                    {formatNZD(transaction.amountCents)}
                  </span>
                </div>
              ))}

              {transactions.length === 0 && (
                <EmptyState
                  compactPad
                  icon="—"
                  title="Nothing yet this period"
                  body={
                    line.isFixed
                      ? "This bill has not landed yet. It stays held aside from safe-to-spend until it does."
                      : "No spending in this category since the period started."
                  }
                />
              )}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

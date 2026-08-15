// The "am I alright?" home.
//
// Answers three questions before the reader has to look at anything else: am
// I over or under, what is safe to spend today, and what bills haven't landed
// yet. Everything else on the page is supporting detail for those three.
//
// A pure server component — no client JavaScript at all. The book switch is
// two links, so there is no state to hydrate.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CategoryTag,
  StatusDot,
} from "@/components/ui/primitives";
import { Figure, KV, PaceBar, Verdict } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { shortDate } from "@/lib/budget/period";
import { getBudgetView, parseBook, resolvePeriod } from "@/lib/budget/query";
import { FirstRun } from "./first-run";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; period?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod(params.period);
  const view = await getBudgetView(book, period, settings);

  const shell = (children: React.ReactNode) => (
    <AppShell
      active="budget"
      book={book}
      period={period}
      basePath="/budget"
      splitFortnightly={settings.splitFortnightly}
    >
      {children}
    </AppShell>
  );

  // Nothing has ever been budgeted. Showing a wall of zeroes would be
  // technically accurate and useless, so the first-run screen spends the
  // history we already have instead.
  if (view.isFirstRun) {
    return shell(<FirstRun view={view} />);
  }

  const { totals } = view;
  const bills = view.categories
    .filter((c) => c.isFixed && !c.paid)
    .sort((a, b) => (a.dueDay ?? 32) - (b.dueDay ?? 32));
  const paidCount = view.categories.filter((c) => c.isFixed && c.paid).length;

  // Worst pace first: the categories most likely to need a decision today.
  const flexible = view.categories
    .filter((c) => !c.isFixed)
    .sort(
      (a, b) =>
        b.spentCents / Math.max(1, b.budgetCents) -
        a.spentCents / Math.max(1, a.budgetCents),
    );

  // The fortnightly split is a display choice: the pay still arrives monthly,
  // so it halves what is shown rather than changing any stored figure.
  const safeCents = settings.splitFortnightly
    ? Math.round(totals.safeCents / 2)
    : totals.safeCents;

  return shell(
    <div className="mb-stack">
      {view.uncategorisedCount > 0 && (
        <Alert level="warning">
          {view.uncategorisedCount} transaction
          {view.uncategorisedCount === 1 ? "" : "s"} this period{" "}
          {view.uncategorisedCount === 1 ? "has" : "have"} no category, so every
          figure below understates what you have actually spent.{" "}
          <Link href={withBook("/transactions?uncategorised=1", book)}>
            Categorise them
          </Link>
          .
        </Alert>
      )}

      {view.unassignedAccountCount > 0 && (
        <Alert level="warning">
          {view.unassignedAccountCount} account
          {view.unassignedAccountCount === 1 ? " is" : "s are"} not assigned to a
          set of books, so their balances are missing from the figures below.
          Run <code>npm run accounts:map</code>.
        </Alert>
      )}

      <div className="mb-hero">
        <div className="mb-hero-left">
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            Safe to spend today
          </div>
          <div
            className="mb-figure"
            style={{
              margin: "6px 0 8px",
              color: safeCents >= 0 ? "var(--text-primary)" : "var(--status-error)",
            }}
          >
            {formatNZD(safeCents)}
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            <span className="mb-num">{formatNZD(totals.perDayCents)}</span> a day
            for the {period.daysLeft === 0 ? "last day" : `${period.daysLeft} days`}{" "}
            to payday
          </div>

          <div
            style={{
              marginTop: "var(--space-5)",
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <KV label="Money in the bank" value={formatNZD(view.balanceCents)} />
            <KV
              label="Bills still to pay"
              value={`− ${formatNZD(totals.fixedRemainingCents)}`}
              tone="var(--money-out)"
            />
            <KV
              label="Budgets not yet spent"
              value={`− ${formatNZD(totals.untouchedCents)}`}
              tone="var(--money-out)"
            />
          </div>
        </div>

        <div className="mb-hero-right">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: "var(--space-5)",
            }}
          >
            <Verdict deltaCents={totals.paceDeltaCents} size="lg" />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              day {period.dayOfPeriod} of {period.daysInPeriod}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              Everyday spending
            </span>
            <span
              className="mb-num"
              style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}
            >
              {formatNZD(totals.flexSpentCents)}{" "}
              <span style={{ color: "var(--text-muted)" }}>
                / {formatNZDWhole(totals.flexBudgetCents)}
              </span>
            </span>
          </div>

          <PaceBar
            spentCents={totals.flexSpentCents}
            budgetCents={totals.flexBudgetCents}
            markerPct={totals.markerPct}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 6,
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
            }}
          >
            <span>spent</span>
            <span>│ today&rsquo;s pace mark: {formatNZD(totals.expectedCents)}</span>
          </div>

          <div
            className="mb-grid-tight"
            style={{
              marginTop: "var(--space-6)",
              paddingTop: "var(--space-5)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <Figure
              label="If you carry on at this rate"
              value={formatNZD(totals.projectedCents)}
              note={`finishes ${formatNZD(Math.abs(totals.projectedDeltaCents))} ${
                totals.projectedDeltaCents >= 0 ? "under" : "over"
              } the ${formatNZDWhole(totals.budgetCents)} plan`}
              noteTone={
                totals.projectedDeltaCents >= 0
                  ? "var(--status-ok)"
                  : "var(--status-error)"
              }
            />
            <Figure
              label="Left in the whole budget"
              value={formatNZD(totals.remainingCents)}
              note={`over ${Math.max(1, period.daysLeft)} days · ${formatNZD(
                Math.round(totals.remainingCents / Math.max(1, period.daysLeft)),
              )} a day`}
            />
          </div>
        </div>
      </div>

      <div className="mb-grid mb-grid-main">
        <Card
          title="Everyday categories"
          padded={false}
          action={
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              worst pace first
            </span>
          }
        >
          <div className="mb-rows">
            {flexible.map((category) => {
              const leftCents = category.budgetCents - category.spentCents;
              const over = leftCents < 0;

              return (
                <Link
                  key={category.categoryId}
                  href={withBook(`/budget/category/${category.categoryId}`, book)}
                  className="mb-row-link mb-row"
                  style={{ padding: "14px 0" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 9,
                      flexWrap: "wrap",
                    }}
                  >
                    <CategoryTag name={category.name} book={category.book} />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        className="mb-num"
                        style={{
                          fontSize: "var(--text-sm)",
                          color: over ? "var(--status-error)" : "var(--text-primary)",
                        }}
                      >
                        {formatNZD(Math.abs(leftCents))}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {/* "over of $0" is nonsense. A category with spending
                            and no budget is a real and common state — it just
                            has not been budgeted yet — so it says so. */}
                        {category.budgetCents === 0
                          ? "spent · not budgeted"
                          : `${over ? "over" : "left"} of ${formatNZDWhole(
                              category.budgetCents,
                            )}`}
                      </span>
                    </div>
                  </div>
                  <PaceBar
                    spentCents={category.spentCents}
                    budgetCents={category.budgetCents}
                    markerPct={totals.markerPct}
                  />
                </Link>
              );
            })}

            {flexible.length === 0 && (
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-muted)",
                  paddingTop: "var(--space-4)",
                }}
              >
                No everyday categories are budgeted yet.{" "}
                <Link href={withBook("/budget/setup", book)}>Set the budget</Link>.
              </p>
            )}
          </div>
        </Card>

        <div className="mb-stack">
          <Card
            title="Bills still to hit"
            action={
              <Badge tone={bills.length ? "warning" : "ok"}>
                {formatNZD(totals.fixedRemainingCents)}
              </Badge>
            }
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              {bills.map((bill) => (
                <div
                  key={bill.categoryId}
                  className="mb-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
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
                      {bill.name}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {bill.dueDate ? shortDate(bill.dueDate) : "no due date"}
                      {bill.estimated ? " · estimate" : ""}
                    </div>
                  </div>
                  <span
                    className="mb-num"
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatNZD(bill.budgetCents)}
                  </span>
                </div>
              ))}

              {bills.length === 0 && (
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--text-muted)",
                    paddingTop: 4,
                  }}
                >
                  Nothing left this period.
                </div>
              )}

              <div
                style={{
                  marginTop: "var(--space-4)",
                  paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  <StatusDot tone="ok" />
                  {paidCount} already paid this period
                </span>
                <ButtonLink
                  href={withBook("/budget/setup", book)}
                  variant="ghost"
                  size="sm"
                >
                  Manage
                </ButtonLink>
              </div>
            </div>
          </Card>

          <Card title="This period">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
              }}
            >
              <KV
                label="Money in"
                value={formatNZD(view.incomeCents)}
                tone="var(--money-in)"
              />
              <KV
                label="Money out so far"
                value={formatNZD(totals.spentCents)}
                tone="var(--money-out)"
              />
              <KV
                label="Budgeted for the period"
                value={formatNZDWhole(totals.budgetCents)}
              />
              <div
                style={{
                  paddingTop: "var(--space-3)",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <KV
                  label={`Next payday ${shortDate(period.nextPayday)}`}
                  value={`in ${period.daysLeft + 1} day${period.daysLeft === 0 ? "" : "s"}`}
                />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>,
  );
}

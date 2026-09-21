// Budget history: is the budget realistic?
//
// `/budget` answers "how am I doing this period". This answers the question
// across periods: which categories run over every month, which are padded,
// and whether the whole thing is drifting. Six complete pay periods, the
// running one deliberately left out — on day 5 every category looks under
// budget, which is arithmetic, not information. Phase 4b spec §2.
//
// The trend chart is an enhancement over the table under it, never a source
// of figures (4b spec §6). Recharts draws nothing without JavaScript — it was
// measured, see the chart component's header — so the table carries every
// number and the page is complete without the chart ever appearing.
//
// That is also why the chart is handed `unbudgetedSpentCents` alongside the
// budgeted spend: the two have to say the same thing. A column drawn from
// budgeted spending alone shows an empty bar over a period with no budgets,
// reading as "nothing was spent" next to a table row saying $8,555.58.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BudgetTrendChart } from "@/components/charts/budget-trend-chart";
import { Alert, ButtonLink, Card, CategoryTag } from "@/components/ui/primitives";
import { ScreenHead } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { iso } from "@/lib/reports/fy";
import {
  HINT_MIN_MARGIN_CENTS,
  HINT_MIN_MARGIN_PERCENT,
  HINT_MIN_PERIODS,
  type BudgetHint,
} from "@/lib/budget/history";
import {
  getBudgetHistory,
  HISTORY_PERIODS,
  parseBook,
  resolvePeriod,
} from "@/lib/budget/query";

export const dynamic = "force-dynamic";

const cell = { padding: "10px 14px 10px 0" } as const;
const numeric = { ...cell, textAlign: "right" } as const;
const muted = { fontSize: "var(--text-xs)", color: "var(--text-muted)" } as const;

export default async function BudgetHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const params = await searchParams;

  // One instant for the whole render: the window is anchored on the running
  // period, and the shell header shows the same period. Two clock reads either
  // side of payday would slide the window by a month under the header.
  const now = new Date();

  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod(undefined, now);
  const view = await getBudgetHistory(book, period, settings);

  const first = view.periods[0].period;
  const last = view.periods[view.periods.length - 1].period;
  const range = `${nzDate(first.start)} – ${nzDate(last.end)}`;

  const shell = (children: React.ReactNode) => (
    <AppShell
      active="budget"
      book={book}
      period={period}
      basePath="/budget/history"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Budget history"
          sub={
            <>
              The {HISTORY_PERIODS} complete pay periods before this one,{" "}
              <strong>{range}</strong>. The period you&apos;re in is on the
              overview, because a part-finished period always looks under
              budget.
            </>
          }
          right={
            <ButtonLink href={withBook("/budget", book)} variant="ghost" size="sm">
              This period
            </ButtonLink>
          }
        />
        {children}
      </div>
    </AppShell>
  );

  // No budget has ever been set for this book — likely for BUSINESS. A table
  // of six "no budget" rows would be accurate and tell the reader nothing.
  if (view.isFirstRun) {
    return shell(
      <Card title="Nothing to compare against yet">
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          No budget has been set for this book, so there is no history of
          budget against spending to show.{" "}
          <Link href={withBook("/budget/setup", book)}>Set the budget</Link>.
        </p>
      </Card>,
    );
  }

  // Budgets exist, but none fall inside the window — the state for the first
  // pay period or two after a budget is first set. Said once, above the table,
  // rather than left for six rows of "no budget" to imply.
  const windowUnbudgeted = view.periods.every((p) => p.allowanceCents === null);

  const categories = [...view.categories].sort(
    (a, b) => b.summary.overCount - a.summary.overCount || a.name.localeCompare(b.name),
  );

  return shell(
    <>
      {view.uncategorisedCount > 0 && (
        <Alert level="warning">
          {view.uncategorisedCount} transaction
          {view.uncategorisedCount === 1 ? "" : "s"} in these periods{" "}
          {view.uncategorisedCount === 1 ? "has" : "have"} no category, so every
          figure below understates what was actually spent — and a category
          looking under budget may simply be missing its spending.{" "}
          <Link
            href={withBook(
              `/transactions?uncategorised=1&from=${iso(first.start)}&to=${iso(last.end)}`,
              book,
            )}
          >
            Categorise them
          </Link>
          .
        </Alert>
      )}

      {view.unassignedAccountCount > 0 && (
        <Alert level="warning">
          {view.unassignedAccountCount} account
          {view.unassignedAccountCount === 1 ? " is" : "s are"} not assigned to a
          set of books, so nothing in {view.unassignedAccountCount === 1 ? "it" : "them"}{" "}
          appears below. Run <code>npm run accounts:map</code>.
        </Alert>
      )}

      <Card title="Whole budget">
        {windowUnbudgeted && (
          <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            No budget was set in any of these periods — budgets here start
            after them. The spending below is the shape of those months, not a
            measure against a budget.
          </p>
        )}

        {/* Draws the same array the table below renders. It appears only once
            JavaScript has run, and adds no figure the table lacks. */}
        <BudgetTrendChart
          points={view.periods.map((p) => ({
            label: p.period.label,
            allowanceCents: p.allowanceCents,
            spentCents: p.spentCents,
            unbudgetedSpentCents: p.unbudgetedSpentCents,
          }))}
        />

        {/* Genuinely tabular, so it stays a table and scrolls sideways on a
            phone, like the monthly report. The date range sits under each
            period's label rather than in a column of its own, for the same
            phone-width reason that screen gives. */}
        <div className="mb-scroll-x">
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  fontSize: "var(--text-xs)",
                  letterSpacing: "var(--tracking-wide)",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                <th style={cell}>Period</th>
                <th style={numeric}>Budget</th>
                <th style={numeric}>Spent</th>
                <th style={numeric}>Over / under</th>
              </tr>
            </thead>
            <tbody style={{ color: "var(--text-secondary)" }}>
              {view.periods.map((p) => (
                <tr key={p.period.label} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    <div>{p.period.label}</div>
                    <div className="mb-num" style={{ ...muted, marginTop: 2 }}>
                      {nzDate(p.period.start)} – {nzDate(p.period.end)}
                    </div>
                    {/* Per period, not only in the alert: this is the likeliest
                        reason one month looks better than its neighbours. */}
                    {p.uncategorisedCount > 0 && (
                      <div style={{ ...muted, marginTop: 2, color: "var(--status-warning)" }}>
                        {p.uncategorisedCount} uncategorised
                      </div>
                    )}
                  </td>

                  <td className="mb-num" style={numeric}>
                    {p.allowanceCents === null ? (
                      <span style={muted}>no budget</span>
                    ) : (
                      formatNZDWhole(p.allowanceCents)
                    )}
                  </td>

                  {/* Spending outside the budget is kept as its own figure:
                      dropped, the period silently shrinks; merged, it reads as
                      an overspend of money nobody budgeted. With no budget at
                      all it IS the period's spending, so it prints as the
                      figure rather than as a footnote under a dash. */}
                  <td className="mb-num" style={numeric}>
                    {p.allowanceCents === null ? (
                      <>
                        {formatNZD(p.unbudgetedSpentCents)}
                        <div style={{ ...muted, marginTop: 2 }}>none of it budgeted</div>
                      </>
                    ) : (
                      <>
                        {formatNZD(p.spentCents)}
                        {/* Refunds can push unbudgeted spending negative, and
                            "+ -$20.00" is not a sentence. A net refund is
                            money coming back, so it says that instead. */}
                        {p.unbudgetedSpentCents > 0 && (
                          <div style={{ ...muted, marginTop: 2 }}>
                            + {formatNZD(p.unbudgetedSpentCents)} not budgeted
                          </div>
                        )}
                        {p.unbudgetedSpentCents < 0 && (
                          <div style={{ ...muted, marginTop: 2 }}>
                            {formatNZD(Math.abs(p.unbudgetedSpentCents))} refunded,
                            outside the budget
                          </div>
                        )}
                      </>
                    )}
                  </td>

                  <td className="mb-num" style={numeric}>
                    <Variance cents={p.varianceCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Worth a look">
        {view.hints.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            Nothing has been consistently over or under its budget by enough
            to matter — at least {formatNZDWhole(HINT_MIN_MARGIN_CENTS)} and{" "}
            {HINT_MIN_MARGIN_PERCENT}%, {HINT_MIN_PERIODS} budgeted periods
            running.
          </p>
        ) : (
          <div className="mb-rows">
            {view.hints.map((hint) => (
              <div key={hint.categoryId} className="mb-row" style={{ padding: "12px 0" }}>
                <div style={{ marginBottom: 6 }}>
                  <CategoryTag name={hint.name} book={book} />
                </div>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  <HintText hint={hint} />{" "}
                  <Link href={withBook("/budget/setup", book)}>Adjust the budget</Link>.
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="By category" padded={false}>
        <div className="mb-rows" style={{ padding: "0 var(--space-6)" }}>
          {categories.map((category) => {
            const { summary } = category;
            return (
              <Link
                key={category.categoryId}
                href={withBook(`/budget/category/${category.categoryId}`, book)}
                className="mb-row-link mb-row"
                style={{
                  padding: "14px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <CategoryTag name={category.name} book={category.book} />
                  <div style={{ ...muted, marginTop: 4 }}>
                    {/* "over in 0 of 2" is the sort key read out loud. The
                        categories that never went over are the ones a reader
                        skips, so they say so in words. */}
                    {summary.budgetedCount === 0
                      ? "no budget in these periods"
                      : summary.overCount === 0
                        ? `never over, in ${summary.budgetedCount} budgeted period${
                            summary.budgetedCount === 1 ? "" : "s"
                          }`
                        : `over in ${summary.overCount} of ${summary.budgetedCount} budgeted period${
                            summary.budgetedCount === 1 ? "" : "s"
                          }`}
                  </div>
                </div>
                <div className="mb-num" style={{ textAlign: "right", fontSize: "var(--text-sm)" }}>
                  <div style={{ color: "var(--text-primary)" }}>
                    {summary.averageSpentCents === null
                      ? "—"
                      : `${formatNZD(summary.averageSpentCents)} avg`}
                  </div>
                  <div style={{ ...muted, marginTop: 2 }}>
                    {category.currentStandingCents === null
                      ? "not budgeted now"
                      : `budget now ${formatNZDWhole(category.currentStandingCents)}`}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </>,
  );
}

/** Over in red, under in green, no budget as a plain dash. */
function Variance({ cents }: { cents: number | null }) {
  if (cents === null) return <span style={muted}>—</span>;
  if (cents === 0) return <span>on budget</span>;
  const over = cents < 0;
  return (
    <span style={{ color: over ? "var(--status-error)" : "var(--status-ok)" }}>
      {formatNZD(Math.abs(cents))} {over ? "over" : "under"}
    </span>
  );
}

/** One hint, worded for what it is: a bill, a $0 budget, or ordinary spending. */
function HintText({ hint }: { hint: BudgetHint & { name: string } }) {
  const average = formatNZD(hint.averageSpentCents);
  const suggested = formatNZDWhole(hint.suggestedCents);
  const runs = `${hint.direction} budget in each of the last three budgeted periods`;

  // Nothing to take a percentage of, so it says what was spent against what.
  if (hint.zeroStanding) {
    return (
      <>
        Budgeted at $0 but averaging <strong>{average}</strong> a period, and
        spent in each of the last three. Something like {suggested} would cover it.
      </>
    );
  }

  const standing = formatNZDWhole(hint.standingCents);

  // A bill's amount isn't a spending choice, so "you overspent" is the wrong
  // reading — the budget figure is what's off, especially if it was estimated.
  if (hint.isFixed) {
    return (
      <>
        This bill has averaged <strong>{average}</strong> against{" "}
        {hint.estimated ? "an estimated" : "a budgeted"} {standing}, {runs}.
        Setting it to {suggested} would match what actually arrives.
      </>
    );
  }

  return (
    <>
      Averaging <strong>{average}</strong> a period against a {standing}{" "}
      budget, {runs}. {hint.direction === "over" ? "Raising" : "Lowering"} it to{" "}
      {suggested} would match what you actually spend.
    </>
  );
}

// Budget history: is the budget realistic?
//
// `/budget` answers "how am I doing this period". This answers the question
// across periods: which categories run over every month, which are padded,
// and whether the whole thing is drifting. Six complete pay periods, the
// running one deliberately left out — on day 5 every category looks under
// budget, which is arithmetic, not information. Phase 4b spec §2.
//
// The trend chart is an enhancement over the tables, never a source of
// figures (4b spec §6). Recharts draws nothing without JavaScript, so the
// tables carry every number and the page is complete without the chart.
//
// That is also why the chart is handed `unbudgetedSpentCents` alongside the
// budgeted spend: the two have to say the same thing. A column drawn from
// budgeted spending alone shows an empty bar over a period with no budgets,
// reading as "nothing was spent" next to a table row saying $8,555.58.
//
// Layout follows the Money Book canvas (Past.dc.html). The "consistently
// over" and "padded" groupings are the existing adjustment hints (4b spec §8)
// grouped by direction, not a second, looser rule.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BudgetTrendChart } from "@/components/charts/budget-trend-chart";
import { Alert, CalendarChip, EmptyState, Icon, Missing } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { dateRange } from "@/lib/budget/period";
import { iso } from "@/lib/reports/fy";
import {
  HINT_MIN_MARGIN_CENTS,
  HINT_MIN_MARGIN_PERCENT,
  HINT_MIN_PERIODS,
  varianceCents,
  type BudgetHint,
} from "@/lib/budget/history";
import {
  getBudgetHistory,
  HISTORY_PERIODS,
  parseBook,
  resolvePeriod,
} from "@/lib/budget/query";

export const dynamic = "force-dynamic";

const month = new Intl.DateTimeFormat("en-NZ", { month: "short", timeZone: "UTC" });

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

  const shell = (children: React.ReactNode) => (
    <AppShell
      active="history"
      book={book}
      period={period}
      basePath="/budget/history"
      splitFortnightly={settings.splitFortnightly}
    >
      <Link
        href={withBook("/budget", book)}
        className="row t-s semi"
        style={{ textDecoration: "none", minHeight: 44 }}
      >
        <Icon name="back" size="sm" />
        Budget
      </Link>
      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">How past periods went</h1>
          <span className="t-s ink2">
            The last {HISTORY_PERIODS} complete pay periods. Budgets shown are what
            was set at the time. The period you&apos;re in is on Budget, because a
            part-finished period always looks under.
          </span>
        </div>
        <CalendarChip kind="pp" label={`${HISTORY_PERIODS} periods`}>
          {dateRange(first.start, last.end)}
        </CalendarChip>
      </div>
      {children}
    </AppShell>
  );

  // No budget has ever been set for this book — likely for BUSINESS. A table
  // of six "no budget" rows would be accurate and tell the reader nothing.
  if (view.isFirstRun) {
    return shell(
      <EmptyState
        icon="chart"
        title="Nothing to compare against yet"
        body="No budget has been set for this book, so there's no history of budget against spending to show."
        action={
          <Link className="btn primary" href={withBook("/budget/setup", book)}>
            Set the budget
          </Link>
        }
      />,
    );
  }

  // Budgets exist, but none fall inside the window — the state for the first
  // pay period or two after a budget is first set. Said once, above the
  // tables, rather than left for six rows of "no budget" to imply.
  const windowUnbudgeted = view.periods.every((p) => p.allowanceCents === null);

  const overHints = view.hints.filter((h) => h.direction === "over");
  const underHints = view.hints.filter((h) => h.direction === "under");
  const hintById = new Map(view.hints.map((h) => [h.categoryId, h]));
  const aboutRight = view.categories.filter(
    (c) => c.summary.budgetedCount >= HINT_MIN_PERIODS && !hintById.has(c.categoryId),
  );

  const categories = [...view.categories].sort(
    (a, b) => b.summary.overCount - a.summary.overCount || a.name.localeCompare(b.name),
  );

  return shell(
    <>
      {view.uncategorisedCount > 0 && (
        <Alert
          title={`${view.uncategorisedCount} transaction${view.uncategorisedCount === 1 ? "" : "s"} in these periods ${view.uncategorisedCount === 1 ? "has" : "have"} no category`}
          affects="Understates: every period's spending. A category looking under may just be missing its spending."
          actions={
            <Link
              className="btn sm"
              href={withBook(
                `/transactions?uncategorised=1&from=${iso(first.start)}&to=${iso(last.end)}`,
                book,
              )}
            >
              Categorise them
            </Link>
          }
        />
      )}

      {view.unassignedAccountCount > 0 && (
        <Alert
          title={`${view.unassignedAccountCount} account${view.unassignedAccountCount === 1 ? " isn't" : "s aren't"} assigned to a book`}
          affects="Missing: everything in it"
        >
          Run <code className="mono">npm run accounts:map</code>.
        </Alert>
      )}

      {windowUnbudgeted && (
        <Alert level="info" title="No budget was set in any of these periods">
          Budgets here start after them. The spending below is the shape of those
          months, not a measure against a budget.
        </Alert>
      )}

      <div className="grid cols-3" style={{ gap: 16 }}>
        <div className={`card stack${overHints.length ? " hl-over" : ""}`} style={{ gap: 6 }}>
          <span className="lbl" style={{ color: overHints.length ? "var(--warn)" : undefined }}>
            Consistently over
          </span>
          <span className="t-m">
            {overHints.length ? overHints.map((h) => h.name).join(" · ") : "Nothing"}
          </span>
          <span className="t-s ink2">
            Over in each of the last {HINT_MIN_PERIODS} budgeted periods, by at least{" "}
            {formatNZDWhole(HINT_MIN_MARGIN_CENTS)} and {HINT_MIN_MARGIN_PERCENT}%.
          </span>
        </div>
        <div className={`card stack${underHints.length ? " hl-pad" : ""}`} style={{ gap: 6 }}>
          <span className="lbl">Padded</span>
          <span className="t-m">
            {underHints.length ? underHints.map((h) => h.name).join(" · ") : "Nothing"}
          </span>
          <span className="t-s ink2">
            Under by the same margin, {HINT_MIN_PERIODS} periods running.
          </span>
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          <span className="lbl">About right</span>
          <span className="t-m">
            {aboutRight.length ? aboutRight.map((c) => c.name).join(" · ") : "Nothing yet"}
          </span>
          <span className="t-s ink2">
            Budgeted at least {HINT_MIN_PERIODS} times with no consistent pattern
            either way.
          </span>
        </div>
      </div>

      <section className="card pad-l stack" style={{ gap: 14 }} aria-label="Whole budget">
        <h2 className="t-m">Whole budget</h2>
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
        <div className="scroll">
          <table className="tbl tight">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Budget</th>
                <th className="num">Spent</th>
                <th className="num">Over / under</th>
              </tr>
            </thead>
            <tbody>
              {view.periods.map((p) => (
                <tr key={p.period.label}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.period.label}
                    <div className="range">{dateRange(p.period.start, p.period.end)}</div>
                    {/* Per period, not only in the alert: this is the likeliest
                        reason one month looks better than its neighbours. */}
                    {p.uncategorisedCount > 0 && (
                      <span className="badge b-need" style={{ marginTop: 4 }}>
                        {p.uncategorisedCount} uncategorised
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {p.allowanceCents === null ? (
                      <Missing>no budget</Missing>
                    ) : (
                      formatNZDWhole(p.allowanceCents)
                    )}
                  </td>
                  {/* Spending outside the budget is kept as its own figure:
                      dropped, the period silently shrinks; merged, it reads as
                      an overspend of money nobody budgeted. With no budget at
                      all it IS the period's spending. */}
                  <td className="num">
                    {p.allowanceCents === null ? (
                      <>
                        {formatNZD(p.unbudgetedSpentCents)}
                        <div className="t-xs ink3">none of it budgeted</div>
                      </>
                    ) : (
                      <>
                        {formatNZD(p.spentCents)}
                        {/* Refunds can push unbudgeted spending negative, and
                            "+ -$20.00" is not a sentence. */}
                        {p.unbudgetedSpentCents > 0 && (
                          <div className="t-xs ink3">
                            + {formatNZD(p.unbudgetedSpentCents)} not budgeted
                          </div>
                        )}
                        {p.unbudgetedSpentCents < 0 && (
                          <div className="t-xs ink3">
                            {formatNZD(Math.abs(p.unbudgetedSpentCents))} refunded, outside
                            the budget
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="num">
                    <Variance cents={p.varianceCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ padding: 0 }} aria-label="Budget versus actual by category">
        <div className="card-h" style={{ padding: "16px 16px 0" }}>
          <h2>By category</h2>
        </div>
        <div className="scroll">
          <table className="tbl" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0 }}>Category</th>
                <th className="num">Budget now</th>
                {view.periods.map((p) => (
                  <th key={p.period.label} className="num" title={dateRange(p.period.start, p.period.end)}>
                    {month.format(p.period.start)}
                  </th>
                ))}
                <th className="num">Average</th>
                <th>Suggestion</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => {
                const hint = hintById.get(category.categoryId);
                return (
                  <tr key={category.categoryId}>
                    <td
                      className="semi"
                      style={{ position: "sticky", left: 0, background: "var(--surface)" }}
                    >
                      <Link href={withBook(`/budget/category/${category.categoryId}`, book)}>
                        {category.name}
                      </Link>
                    </td>
                    <td className="num ink2">
                      {category.currentStandingCents === null ? (
                        <Missing>none</Missing>
                      ) : (
                        formatNZDWhole(category.currentStandingCents)
                      )}
                    </td>
                    {category.cells.map((cell) => {
                      const v = varianceCents(cell);
                      const cls =
                        hint?.direction === "over" && v !== null && v < 0
                          ? "num hl-over"
                          : hint?.direction === "under" && v !== null && v > 0
                            ? "num hl-pad"
                            : "num";
                      return (
                        <td key={cell.period.label} className={cls}>
                          {cell.spentCents === 0 && cell.allowance === null ? (
                            <span className="ink3">—</span>
                          ) : (
                            formatNZD(cell.spentCents)
                          )}
                        </td>
                      );
                    })}
                    <td className="num semi">
                      {category.summary.averageSpentCents === null
                        ? "—"
                        : formatNZD(category.summary.averageSpentCents)}
                    </td>
                    <td>
                      <Suggestion summary={category.summary} hint={hint} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="t-xs ink3" style={{ padding: "12px 16px" }}>
          Columns are pay periods named by the month they start in; hover a heading
          for its dates. Averages cover budgeted periods only. Highlighted cells are
          the periods behind a suggestion.
        </p>
      </section>

      {view.hints.length > 0 && (
        <section className="card pad-l stack" style={{ gap: 4 }} aria-label="Worth a look">
          <h2 className="t-m">Worth a look</h2>
          {view.hints.map((hint) => (
            <div key={hint.categoryId} className="li" style={{ display: "block" }}>
              <p className="semi">{hint.name}</p>
              <p className="t-s ink2">
                <HintText hint={hint} />{" "}
                <Link href={withBook("/budget/setup", book)}>Adjust the budget</Link>
              </p>
            </div>
          ))}
        </section>
      )}
    </>,
  );
}

/** Over and under in words; colour only reinforces them. */
function Variance({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="ink3">—</span>;
  if (cents === 0) return <span>on budget</span>;
  const over = cents < 0;
  return (
    <span className={`delta ${over ? "behind" : "ahead"}`} style={{ padding: "2px 8px", fontSize: 13 }}>
      {formatNZD(Math.abs(cents))} {over ? "over" : "under"}
    </span>
  );
}

function Suggestion({
  summary,
  hint,
}: {
  summary: { budgetedCount: number; overCount: number };
  hint?: BudgetHint;
}) {
  if (summary.budgetedCount === 0) return <span className="badge">No budget in window</span>;
  if (hint?.direction === "over") {
    return (
      <>
        <span className="badge b-warn">
          Over {summary.overCount} of {summary.budgetedCount}
        </span>{" "}
        <span className="t-s ink2">Raise to {formatNZDWhole(hint.suggestedCents)}</span>
      </>
    );
  }
  if (hint?.direction === "under") {
    return (
      <>
        <span className="badge b-pend">Padded</span>{" "}
        <span className="t-s ink2">Try {formatNZDWhole(hint.suggestedCents)}</span>
      </>
    );
  }
  return <span className="badge b-ok">No change suggested</span>;
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
        Budgeted at $0 but averaging <strong>{average}</strong> a period, and spent
        in each of the last three. Something like {suggested} would cover it.
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
        {hint.estimated ? "an estimated" : "a budgeted"} {standing}, {runs}. Setting
        it to {suggested} would match what actually arrives.
      </>
    );
  }

  return (
    <>
      Averaging <strong>{average}</strong> a period against a {standing} budget,{" "}
      {runs}. {hint.direction === "over" ? "Raising" : "Lowering"} it to {suggested}{" "}
      would match what you actually spend.
    </>
  );
}

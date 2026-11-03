// One category, in detail.
//
// Two shapes, because a category has two meanings. A flexible one gets pace
// figures and an even-spending mark. A fixed bill gets a due date and a
// paid/unpaid state, and none of the pace furniture — the question for a bill
// is "has it landed?", not "am I going too fast?".
//
// Layout follows the Money Book canvas (Category.dc.html).

import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BudgetTrendChart } from "@/components/charts/budget-trend-chart";
import {
  CalendarChip,
  EmptyState,
  Icon,
  Missing,
  Provenance,
} from "@/components/ui/primitives";
import { DayBars, PaceBar, Verdict } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { dateRange, nzDate } from "@/lib/budget/period";
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

  const { category, line, transactions, series, history } = detail;

  // The category's own book, never `?book=`. A category id already determines
  // its book, so a querystring that disagrees is either a stale link or a
  // typo — and honouring it would wrap a personal category in the business
  // shell, with every nav link sending you into the wrong ledger.
  const book = category.book;

  const leftCents = line.budgetCents - line.spentCents;
  const expectedCents = Math.round(line.budgetCents * period.elapsed);
  // Day 1 has no run rate yet, so there is nothing to project from.
  const projectedCents =
    period.dayOfPeriod > 1
      ? Math.round((line.spentCents / period.dayOfPeriod) * period.daysInPeriod)
      : line.budgetCents;
  const todayIndex = period.dayOfPeriod - 1;
  const { summary, hint } = history;

  return (
    <AppShell
      active="budget"
      book={book}
      period={period}
      basePath={`/budget/category/${id}`}
      splitFortnightly={settings.splitFortnightly}
      lockBook
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
        <div className="grow stack" style={{ gap: 8 }}>
          <div className="row wrap">
            <h1 className="t-xl">{category.name}</h1>
            <span className="badge">{line.isFixed ? "Fixed bill" : "Everyday category"}</span>
            {category.taxTag && (
              <span className="badge">{category.taxTag.replace(/_/g, " ").toLowerCase()}</span>
            )}
          </div>
          <span className="t-s ink2">
            <span className="num">{formatNZD(line.spentCents)}</span> spent
            {line.budgetCents > 0 ? (
              <>
                {" "}
                of <span className="num">{formatNZDWhole(line.budgetCents)}</span> ·{" "}
                <span className="num">{formatNZD(Math.abs(leftCents))}</span>{" "}
                {leftCents < 0 ? "over" : "left"}
              </>
            ) : (
              <> · no budget this period</>
            )}
          </span>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <CalendarChip kind="pp" label="Pay period">
            {dateRange(period.start, period.end)}
          </CalendarChip>
          <Link className="btn sm" href={withBook("/budget/setup", book)}>
            Change budget
          </Link>
        </div>
      </div>

      {line.isFixed ? (
        <section className="card pad-l stack" style={{ gap: 14 }} aria-label="Bill">
          <div className="row between wrap">
            <span className="lbl">Bill · {line.paid ? "landed" : "not yet landed"}</span>
            <span className={line.paid ? "badge b-ok" : "badge b-warn"}>
              {line.paid ? "Paid this period" : "Not yet paid"}
            </span>
          </div>
          <p className="t-s ink2">
            {line.dueDate ? (
              <>
                Due <span className="num">{nzDate(line.dueDate)}</span>.{" "}
              </>
            ) : (
              "No due day set. "
            )}
            {line.estimated
              ? "The amount is an estimate from past bills, so it may land higher or lower."
              : "Held aside in full from safe to spend until it lands."}
          </p>
        </section>
      ) : (
        <section className="card pad-l stack" style={{ gap: 14 }} aria-label="Pace">
          <div className="row between wrap">
            <span className="lbl">
              Pace · day {period.dayOfPeriod} of {period.daysInPeriod}
            </span>
            {line.budgetCents > 0 && (
              <Verdict deltaCents={expectedCents - line.spentCents} size="lg" />
            )}
          </div>
          <PaceBar
            spentCents={line.spentCents}
            budgetCents={line.budgetCents}
            markerPct={period.elapsed * 100}
            thick
          />
          {line.budgetCents > 0 ? (
            <p className="t-s ink2">
              Even spending would be <span className="num">{formatNZD(expectedCents)}</span>{" "}
              by today. At this rate you&apos;ll reach{" "}
              <span className="num">{formatNZD(projectedCents)}</span> by{" "}
              {nzDate(period.end).slice(0, 5)},{" "}
              <span className="num">
                {formatNZD(Math.abs(line.budgetCents - projectedCents))}
              </span>{" "}
              {projectedCents > line.budgetCents ? "over" : "under"}.
            </p>
          ) : (
            <p className="t-s ink2">
              <Missing>no budget yet</Missing> There&apos;s spending here but nothing
              to pace it against. <Link href={withBook("/budget/setup", book)}>Set one</Link>.
            </p>
          )}
          {line.carryoverCents !== 0 && (
            <p className="t-xs ink3">
              Includes {formatNZD(Math.abs(line.carryoverCents))}{" "}
              {line.carryoverCents > 0 ? "carried over from" : "being repaid from"} last
              period, on top of a standing budget of {formatNZDWhole(line.standingCents)}.
            </p>
          )}
        </section>
      )}

      <div className="grid cols-main" style={{ gap: 20, alignItems: "start" }}>
        <div className="stack" style={{ gap: 20 }}>
          <section className="card pad-l stack" style={{ gap: 12 }} aria-label="Daily spending">
            <div className="row between wrap">
              <h2 className="t-m">Daily spending</h2>
              <div className="legend">
                <span>
                  <span className="sw" style={{ background: "var(--accent)" }} />
                  Spent
                </span>
                <span>
                  <span className="sw" style={{ background: "var(--line-2)", height: 2 }} />
                  Nothing spent
                </span>
                <span>
                  <span className="sw" style={{ border: "1px dashed var(--line-2)" }} />
                  Not yet
                </span>
              </div>
            </div>
            <DayBars
              series={series.map((day, i) => ({ ...day, today: i === todayIndex }))}
            />
            <div className="row between range">
              <span>{nzDate(period.start).slice(0, 5)}</span>
              <span>today</span>
              <span>{nzDate(period.end).slice(0, 5)}</span>
            </div>
            <p className="t-xs ink3">
              Each day is labelled on hover. Exact figures are in the list below.
            </p>
          </section>

          <section className="stack" style={{ gap: 10 }} aria-label="Transactions">
            <div className="row between">
              <h2 className="t-m">
                {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
              </h2>
              <Link
                className="t-s semi"
                href={withBook(`/transactions?category=${category.id}`, book)}
              >
                Open in Transactions
              </Link>
            </div>
            {transactions.length === 0 ? (
              <EmptyState
                icon="list"
                title="Nothing yet this period"
                body={
                  line.isFixed
                    ? "This bill hasn't landed yet. It stays held aside from safe to spend until it does."
                    : "No spending in this category since the period started."
                }
              />
            ) : (
              <div className="txl">
                {transactions.map((t) => (
                  <Link
                    key={t.id}
                    className="tx"
                    href={withBook(`/transactions/${t.id}`, book)}
                    style={{
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gridTemplateAreas: "'desc amt' 'cat eff'",
                    }}
                  >
                    <span className="c-desc">
                      <span className="d1" style={{ display: "block" }}>
                        {t.payee ?? t.description}
                      </span>
                    </span>
                    <span className={t.amountCents > 0 ? "c-amt m in" : "c-amt m"}>
                      {t.amountCents > 0 ? "+" : ""}
                      {formatNZD(Math.abs(t.amountCents))}
                    </span>
                    <span className="c-cat">
                      <span className="range">{nzDate(t.date)}</span>
                      <Provenance source={t.categorySource} short />
                    </span>
                    <span className="c-eff">{t.account.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* The same window `/budget/history` shows, for this category alone,
            from the same functions, so the two can't quote a different budget
            for the same period. */}
        <section className="card pad-l stack" style={{ gap: 14 }} aria-label="Trend">
          <div className="row between wrap">
            <h2 className="t-m">Past {history.cells.length} pay periods</h2>
            {summary.budgetedCount === 0 ? (
              <span className="badge">Not budgeted in this window</span>
            ) : summary.overCount === 0 ? (
              <span className="badge b-ok">Never over</span>
            ) : (
              <span className="badge b-warn">
                Over {summary.overCount} of {summary.budgetedCount}
              </span>
            )}
          </div>
          {/* Spending in a period with no budget is NOT budgeted spend, and
              drawing it in the budgeted tone would show a bar beside a table
              row reading "no budget". */}
          <BudgetTrendChart
            points={history.cells.map((cell) => ({
              label: cell.period.label,
              allowanceCents: cell.allowance?.allowanceCents ?? null,
              spentCents: cell.allowance ? cell.spentCents : 0,
              unbudgetedSpentCents: cell.allowance ? 0 : cell.spentCents,
            }))}
          />
          <table className="tbl tight">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Budget</th>
                <th className="num">Spent</th>
                <th className="num">vs budget</th>
              </tr>
            </thead>
            <tbody>
              {history.cells.map((cell) => {
                const variance =
                  cell.allowance === null ? null : cell.allowance.allowanceCents - cell.spentCents;
                return (
                  <tr key={cell.period.label}>
                    <td className="range" style={{ fontSize: 13 }}>
                      {dateRange(cell.period.start, cell.period.end).replace(/\/\d{4}$/, "")}
                    </td>
                    <td className="num">
                      {cell.allowance === null ? (
                        <Missing>no budget</Missing>
                      ) : (
                        formatNZDWhole(cell.allowance.allowanceCents)
                      )}
                    </td>
                    <td className="num">{formatNZD(cell.spentCents)}</td>
                    <td className="num">
                      {variance === null
                        ? "—"
                        : variance === 0
                          ? "on budget"
                          : `${formatNZD(Math.abs(variance))} ${variance < 0 ? "over" : "under"}`}
                    </td>
                  </tr>
                );
              })}
              {summary.averageSpentCents !== null && (
                <tr className="tot">
                  <td>Average</td>
                  <td />
                  <td className="num">{formatNZD(summary.averageSpentCents)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {hint && (
            <p className="t-s ink2">
              <span className="semi">Hint:</span>{" "}
              {hint.direction === "over" ? "raise" : "lower"} {category.name} to{" "}
              <span className="num">{formatNZDWhole(hint.suggestedCents)}</span>, its
              average over the last {hint.periods} budgeted periods.{" "}
              <Link href={withBook("/budget/setup", book)}>Adjust</Link>
            </p>
          )}
          <p className="t-xs ink3">
            The running period isn&apos;t in this table; it&apos;s the rest of this
            screen. <Link href={withBook("/budget/history", book)}>Every category&apos;s history</Link>
          </p>
        </section>
      </div>
    </AppShell>
  );
}

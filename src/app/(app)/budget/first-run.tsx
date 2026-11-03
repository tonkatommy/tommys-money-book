// /budget before a budget exists.
//
// Three periods of transactions have already synced and been categorised, so
// this screen spends that history rather than announcing an empty state. The
// difference matters: "no budget yet" is a dead end, whereas "here is what
// you actually spend, shall we start there?" is one click from done.
//
// Layout follows the canvas's Budget artboard in its "empty" state.

import Link from "next/link";
import { Alert, CalendarChip, EmptyState } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { dateRange } from "@/lib/budget/period";
import type { BudgetView } from "@/lib/budget/query";
import { SUGGESTION_PERIODS } from "@/lib/budget/query";

export function FirstRun({ view }: { view: BudgetView }) {
  const { book, period } = view;
  const bookName = book === "BUSINESS" ? "Business" : "Personal";

  // Everything with a history worth budgeting. A category nobody has spent
  // anything in over three periods does not need a line.
  const suggested = view.allCategories
    .filter((category) => category.averageCents > 0)
    .sort((a, b) => b.averageCents - a.averageCents);

  const flexible = suggested.filter((c) => !c.isFixed);
  const bills = suggested.filter((c) => c.isFixed);
  const billsTotal = bills.reduce((sum, c) => sum + c.averageCents, 0);
  const suggestedTotal = suggested.reduce((sum, c) => sum + c.averageCents, 0);
  // The average, not this period's income so far. A full period's budget
  // compared against a part-elapsed period's income says you are hundreds of
  // percent overcommitted — arithmetic rather than information.
  const spareCents = view.averageIncomeCents - suggestedTotal;

  const head = (
    <div className="page-h">
      <div className="grow stack" style={{ gap: 6 }}>
        <h1 className="t-xl">Budget</h1>
        <span className="t-s ink2">{bookName} book · no budget set yet</span>
      </div>
      <CalendarChip kind="pp" label="Pay period">
        {dateRange(period.start, period.end)}
      </CalendarChip>
    </div>
  );

  if (suggested.length === 0) {
    return (
      <>
        {head}
        <EmptyState
          icon="sliders"
          title="Not enough history to suggest a budget yet"
          body="Once a few periods of transactions have synced and been categorised, this screen suggests a budget from what you actually spend. You can still set one by hand now."
          action={
            <div className="row wrap" style={{ gap: 10, justifyContent: "center" }}>
              <Link className="btn primary" href={withBook("/budget/setup", book)}>
                Set a budget by hand
              </Link>
              {/* First run is when a tour is most wanted. */}
              <Link className="btn ghost" href={withBook("/guide", book)}>
                How to use this app
              </Link>
            </div>
          }
        />
      </>
    );
  }

  return (
    <>
      <Alert level="info" title="Your bank feeds are in. Now you need a budget.">
        Until you set one there&apos;s nothing to measure pace or safe-to-spend
        against, so this shows your averages instead.
      </Alert>

      {head}

      <section className="card pad-l stack" style={{ gap: 16 }}>
        <div className="row between wrap">
          <h2 className="t-l">No budget yet</h2>
          <span className="range">
            Average of your last {SUGGESTION_PERIODS} pay periods, before{" "}
            {dateRange(period.start, period.end).split(" – ")[0]}
          </span>
        </div>
        <p className="t-s ink2">
          This is what you&apos;ve actually spent per pay period: the mean per
          category, not the highest and not just the latest. Use it as a starting
          point, then adjust on Set budget.
        </p>
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <table className="tbl tight">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Avg per period</th>
              </tr>
            </thead>
            <tbody>
              {flexible.map((category) => (
                <tr key={category.categoryId}>
                  <td>{category.name}</td>
                  <td className="num">{formatNZD(category.averageCents)}</td>
                </tr>
              ))}
              {bills.length > 0 && (
                <tr>
                  <td>
                    {bills.length} fixed bill{bills.length === 1 ? "" : "s"}{" "}
                    <span className="badge b-fixed">Fixed</span>
                    <div className="t-xs ink3">{bills.map((b) => b.name).join(", ")}</div>
                  </td>
                  <td className="num">{formatNZD(billsTotal)}</td>
                </tr>
              )}
              <tr className="tot">
                <td>Suggested budget</td>
                <td className="num">{formatNZDWhole(suggestedTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="grid cols-2" style={{ gap: 10 }}>
          <div className="stack">
            <span className="t-xs ink3">Money in each period, on average</span>
            <span className="m in">+{formatNZD(view.averageIncomeCents)}</span>
          </div>
          <div className="stack">
            <span className="t-xs ink3">
              {spareCents >= 0 ? "Would be left over" : "Would be short by"}
            </span>
            <span className="m" style={{ color: spareCents < 0 ? "var(--bad)" : undefined }}>
              {formatNZD(Math.abs(spareCents))}
            </span>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <Link className="btn primary" href={withBook("/budget/setup?seed=averages", book)}>
            Build my budget from these
          </Link>
          <Link className="btn" href={withBook("/budget/setup", book)}>
            Start from blank
          </Link>
          <Link className="btn ghost" href={withBook("/guide", book)}>
            New here? Take the tour
          </Link>
        </div>
      </section>

      <EmptyState
        icon="cycle"
        title="Safe to spend appears once a budget exists"
        body="It's money in the bank, minus bills still to hit, minus everyday budgets you haven't spent yet. Without a budget, that last part is unknown."
      />
    </>
  );
}

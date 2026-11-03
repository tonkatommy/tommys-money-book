// The "am I alright?" home.
//
// Answers three questions before the reader has to look at anything else:
// what is safe to spend today, am I ahead of or behind pace, and what bills
// haven't landed yet. Everything else on the page is supporting detail.
//
// Anything that makes those figures low comes first, above them: a stopped
// sync, uncategorised spending, an account in neither book. A warning below
// the number it bends gets read after the number has already been believed.
//
// A pure server component — no client JavaScript at all. Layout follows the
// Money Book canvas (Budget.dc.html).

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Alert, CalendarChip, Icon, Missing } from "@/components/ui/primitives";
import { PaceBar, Verdict } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { dateRange, nzDate, nzDateTime } from "@/lib/budget/period";
import { getBudgetView, parseBook, resolvePeriod } from "@/lib/budget/query";
import { linePaceDeltaCents } from "@/lib/budget/totals";
import { getShellStatus } from "@/lib/shell";
import { FirstRun } from "./first-run";

export const dynamic = "force-dynamic";

const weekday = new Intl.DateTimeFormat("en-NZ", { weekday: "short", timeZone: "UTC" });

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; period?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod(params.period);
  const [view, status] = await Promise.all([
    getBudgetView(book, period, settings),
    getShellStatus(book, period),
  ]);

  const shell = (children: React.ReactNode) => (
    <AppShell
      active="budget"
      book={book}
      period={period}
      basePath="/budget"
      preserveQuery={params.period ? `period=${params.period}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      {children}
    </AppShell>
  );

  const bookName = book === "BUSINESS" ? "Business" : "Personal";
  const range = dateRange(period.start, period.end);

  const syncBanner =
    status.health === "failing" ? (
      <Alert
        level="error"
        title="Bank sync is failing, so these figures may be out of date"
        affects={
          status.lastSuccess
            ? `Last good sync: ${nzDateTime(status.lastSuccess)}`
            : "No successful sync on record"
        }
        actions={
          <Link className="btn sm" href="/sync">
            See what failed
          </Link>
        }
      >
        The most recent sync run ended in an error. Anything since the last good
        sync is missing from every balance and total below.
      </Alert>
    ) : status.health === "overdue" ? (
      <Alert
        icon="sync"
        title="Sync is overdue"
        affects={
          status.lastSuccess
            ? `Figures as of ${nzDateTime(status.lastSuccess)}`
            : "No successful sync on record"
        }
        actions={
          <Link className="btn sm" href="/sync">
            Check sync status
          </Link>
        }
      >
        This morning&apos;s sync hasn&apos;t happened. A stopped sync looks just
        like a quiet day, so recent spending may be missing.
      </Alert>
    ) : null;

  // Nothing has ever been budgeted. Showing a wall of zeroes would be
  // technically accurate and useless, so the first-run screen spends the
  // history we already have instead.
  if (view.isFirstRun) {
    return shell(
      <>
        {syncBanner}
        <FirstRun view={view} />
      </>,
    );
  }

  const { totals } = view;
  const bills = view.categories
    .filter((c) => c.isFixed && !c.paid)
    .sort((a, b) => (a.dueDay ?? 32) - (b.dueDay ?? 32));
  const paid = view.categories.filter((c) => c.isFixed && c.paid);

  // Worst pace first: the categories most likely to need a decision today.
  // Unbudgeted spending leads, because it has no budget to be measured
  // against at all.
  const flexible = view.categories
    .filter((c) => !c.isFixed)
    .sort(
      (a, b) =>
        b.spentCents / Math.max(1, b.budgetCents) -
        a.spentCents / Math.max(1, a.budgetCents),
    );
  const untouched = flexible.filter((c) => c.budgetCents > 0 && c.spentCents === 0);
  const shown = flexible.filter((c) => !(c.budgetCents > 0 && c.spentCents === 0));

  // The fortnightly split is a display choice: the pay still arrives monthly,
  // so it halves what is shown rather than changing any stored figure.
  const safeCents = settings.splitFortnightly
    ? Math.round(totals.safeCents / 2)
    : totals.safeCents;

  const warnings = [
    view.uncategorisedCount > 0 && (
      <Alert
        key="uncat"
        title={`${view.uncategorisedCount} transaction${view.uncategorisedCount === 1 ? " has" : "s have"} no category`}
        affects="Understates: spending, pace, safe to spend"
        actions={
          <Link
            className="btn sm"
            href={withBook("/transactions?uncategorised=1", book)}
          >
            Categorise {view.uncategorisedCount}
          </Link>
        }
      >
        Their spending isn&apos;t counted in any budget yet.
      </Alert>
    ),
    view.unassignedAccountCount > 0 && (
      <Alert
        key="unmapped"
        title={`${view.unassignedAccountCount} account${view.unassignedAccountCount === 1 ? " isn't" : "s aren't"} assigned to a book`}
        affects="Understates: balances in one of your books"
        actions={
          <Link className="btn sm" href="/sync">
            See which
          </Link>
        }
      >
        Synced, but counted in neither book. Run{" "}
        <code className="mono">npm run accounts:map</code> to assign it.
      </Alert>
    ),
  ].filter(Boolean);

  return shell(
    <>
      {syncBanner}

      {warnings.length > 0 && (
        <div className="banners">
          <span className="banners-h">
            <Icon name="warn" size="sm" />
            {warnings.length === 1
              ? "1 thing is making these figures low"
              : `${warnings.length} things are making these figures low`}
          </span>
          <div className={warnings.length > 1 ? "grid cols-2" : "grid"} style={{ gap: 10 }}>
            {warnings}
          </div>
        </div>
      )}

      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Budget</h1>
          <span className="t-s ink2">
            {bookName} book · day {period.dayOfPeriod} of {period.daysInPeriod} in
            this pay period
          </span>
        </div>
        <CalendarChip kind="pp" label="Pay period">
          {range}
        </CalendarChip>
      </div>

      <div className="grid cols-main" style={{ gap: 20 }}>
        <section className="card pad-l stack" style={{ gap: 16 }} aria-label="Safe to spend">
          <div className="row between wrap">
            <span className="lbl">
              Safe to spend today{settings.splitFortnightly ? " · half view" : ""}
            </span>
            {status.lastSuccess && (
              <span className="range">
                Balances as of {nzDateTime(status.lastSuccess)}
              </span>
            )}
          </div>
          <span
            className="t-hero mono"
            style={{
              fontWeight: 600,
              color: safeCents < 0 ? "var(--bad)" : undefined,
              opacity: status.health === "failing" ? 0.55 : 1,
            }}
          >
            {safeCents < 0 ? "−" : ""}
            {formatNZD(Math.abs(safeCents))}
          </span>
          <p className="t-m" style={{ fontWeight: 400 }}>
            {safeCents < 0 ? (
              <>
                You&apos;re <span className="m">{formatNZD(Math.abs(safeCents))}</span>{" "}
                short of covering the bills and budgets still to come before payday on{" "}
                {nzDate(period.nextPayday).slice(0, 5)}.
              </>
            ) : (
              <>
                That&apos;s <span className="m">{formatNZD(totals.perDayCents)}</span> a day
                for the{" "}
                {period.daysLeft === 0 ? "last day" : `${period.daysLeft} days`} to payday on{" "}
                {nzDate(period.nextPayday).slice(0, 5)}.
              </>
            )}
          </p>
          <div
            className="eq"
            style={{ background: "var(--sunk)", borderRadius: 10, padding: "14px 16px" }}
          >
            <span className="op" />
            <span>In the bank</span>
            <span className="m">{formatNZD(view.balanceCents)}</span>
            <span className="op">−</span>
            <span>Bills still to hit · {bills.length}</span>
            <span className="m">{formatNZD(totals.fixedRemainingCents)}</span>
            <span className="op">−</span>
            <span>Everyday budget not yet spent</span>
            <span className="m">{formatNZD(totals.untouchedCents)}</span>
            <span className="op tot">=</span>
            <span className="tot">Safe to spend</span>
            <span className="m tot">
              {totals.safeCents < 0 ? "−" : ""}
              {formatNZD(Math.abs(totals.safeCents))}
            </span>
          </div>
        </section>

        <section className="card pad-l stack" style={{ gap: 16 }} aria-label="Pace">
          <div className="row between wrap">
            <span className="lbl">Pace · everyday spending</span>
            <Verdict deltaCents={totals.paceDeltaCents} size="lg" />
          </div>
          <div style={{ marginTop: 8 }}>
            <PaceBar
              spentCents={totals.flexSpentCents}
              budgetCents={totals.flexBudgetCents}
              markerPct={totals.markerPct}
              thick
            />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <div className="stack">
              <span className="t-xs ink3">Spent so far</span>
              <span className="m">{formatNZD(totals.flexSpentCents)}</span>
            </div>
            <div className="stack">
              <span className="t-xs ink3">Even pace today</span>
              <span className="m">{formatNZD(totals.expectedCents)}</span>
            </div>
            <div className="stack">
              <span className="t-xs ink3">Budget</span>
              <span className="m">{formatNZDWhole(totals.flexBudgetCents)}</span>
            </div>
          </div>
          <div className="hr" />
          <p className="t-s">
            <span className="semi">At this rate:</span>{" "}
            <span className="m">{formatNZD(totals.projectedCents)}</span> by{" "}
            {nzDate(period.end).slice(0, 5)}, which is{" "}
            <span className="m">{formatNZD(Math.abs(totals.projectedDeltaCents))}</span>{" "}
            {totals.projectedDeltaCents >= 0 ? "under" : "more than"} the{" "}
            {formatNZDWhole(totals.budgetCents)} budgeted, bills included.
          </p>
          {view.uncategorisedCount > 0 && (
            <p className="t-xs ink3">
              Excludes the {view.uncategorisedCount} uncategorised transaction
              {view.uncategorisedCount === 1 ? "" : "s"}.
            </p>
          )}
        </section>
      </div>

      <div className="grid cols-main" style={{ gap: 20, alignItems: "start" }}>
        <section className="card" style={{ padding: "8px 20px 12px" }} aria-label="Everyday categories">
          <div className="card-h" style={{ margin: "12px 0 4px" }}>
            <h2>Everyday categories</h2>
            <span className="t-xs ink3">Worst pace first · marker = even spending today</span>
          </div>

          {shown.map((category) => {
            const leftCents = category.budgetCents - category.spentCents;
            const delta = linePaceDeltaCents(category, period);
            return (
              <Link
                key={category.categoryId}
                className="catrow"
                href={withBook(`/budget/category/${category.categoryId}`, book)}
                style={{ paddingLeft: 0, paddingRight: 0 }}
              >
                <span className="semi">{category.name}</span>
                <span className="num t-s">
                  {formatNZD(category.spentCents)}
                  {category.budgetCents > 0 && (
                    <span className="ink3"> of {formatNZDWhole(category.budgetCents)}</span>
                  )}
                </span>
                <PaceBar
                  spentCents={category.spentCents}
                  budgetCents={category.budgetCents}
                  markerPct={totals.markerPct}
                />
                <span className="meta">
                  {delta === null ? (
                    // "over of $0" is nonsense. Spending with no budget is a
                    // real and common state — it just hasn't been budgeted.
                    <>
                      <Missing>no budget yet</Missing>
                      <span className="badge b-need">Spent, not budgeted</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {formatNZD(Math.abs(leftCents))} {leftCents < 0 ? "over" : "left"}
                      </span>
                      <span
                        className={`delta ${delta >= 0 ? "ahead" : "behind"}`}
                        style={{ padding: "2px 8px", fontSize: 13 }}
                      >
                        {delta >= 0 ? "Ahead by " : "Behind by "}
                        {formatNZD(Math.abs(delta))}
                      </span>
                    </>
                  )}
                </span>
              </Link>
            );
          })}

          {flexible.length === 0 && (
            <p className="t-s ink2" style={{ padding: "14px 0" }}>
              No everyday categories are budgeted yet.{" "}
              <Link href={withBook("/budget/setup", book)}>Set the budget</Link>.
            </p>
          )}

          {untouched.length > 0 && (
            <div className="row between wrap" style={{ padding: "14px 0 4px" }}>
              <span className="t-s ink2">
                {untouched.length} untouched: {untouched.map((c) => c.name).join(", ")}
              </span>
              <span className="num t-s">
                {formatNZD(untouched.reduce((sum, c) => sum + c.budgetCents, 0))} set aside
              </span>
            </div>
          )}
        </section>

        <section className="card" style={{ padding: "8px 20px 12px" }} aria-label="Bills still to hit">
          <div className="card-h" style={{ margin: "12px 0 4px" }}>
            <h2>Bills still to hit</h2>
            <span className="m">{formatNZD(totals.fixedRemainingCents)}</span>
          </div>
          {bills.map((bill) => (
            <div key={bill.categoryId} className="bill">
              <span className="due">
                {bill.dueDate ? (
                  <>
                    <b>{nzDate(bill.dueDate).slice(0, 5)}</b>
                    {weekday.format(bill.dueDate)}
                  </>
                ) : (
                  "no date"
                )}
              </span>
              <span className="stack" style={{ gap: 4 }}>
                <span className="semi">{bill.name}</span>
                {bill.estimated && (
                  <span className="badge b-est" style={{ alignSelf: "flex-start" }}>
                    Estimate · from past bills
                  </span>
                )}
              </span>
              <span className="m">{formatNZD(Math.max(0, bill.budgetCents - bill.spentCents))}</span>
            </div>
          ))}
          {bills.length === 0 && (
            <p className="t-s ink2" style={{ padding: "12px 0" }}>
              Nothing left to come out this period.
            </p>
          )}
          <p className="t-xs ink3" style={{ padding: "10px 0 4px" }}>
            {paid.length} bill{paid.length === 1 ? "" : "s"} already paid this period (
            {formatNZD(paid.reduce((sum, c) => sum + c.spentCents, 0))}).{" "}
            <Link href={withBook("/budget/setup", book)}>Manage bills</Link>
          </p>
        </section>
      </div>

      <div className="grid cols-3" style={{ gap: 12 }}>
        <Link className="card row" href={withBook("/budget/history", book)}>
          <Icon name="chart" />
          <span className="grow stack">
            <span className="semi">How past periods went</span>
            <span className="t-xs ink3">Last 6 complete pay periods</span>
          </span>
          <Icon name="chev" size="sm" />
        </Link>
        {/* Personal only, like the goals themselves (4c spec §1): on the
            business book this link would imply business goals exist. */}
        {book === "PERSONAL" && (
          <Link className="card row" href="/goals">
            <Icon name="target" />
            <span className="grow stack">
              <span className="semi">Savings goals</span>
              <span className="t-xs ink3">Personal book</span>
            </span>
            <Icon name="chev" size="sm" />
          </Link>
        )}
        <Link className="card row" href={withBook("/budget/review", book)}>
          <Icon name="calcheck" />
          <span className="grow stack">
            <span className="semi">Month end review</span>
            <span className="t-xs ink3">Close last period, set this one</span>
          </span>
          <Icon name="chev" size="sm" />
        </Link>
        {/* The guide's way in on a phone, where the sidebar is hidden. */}
        <Link className="card row ph-only" href={withBook("/guide", book)}>
          <Icon name="help" />
          <span className="grow stack">
            <span className="semi">How to use this app</span>
            <span className="t-xs ink3">A 14-step tour</span>
          </span>
          <Icon name="chev" size="sm" />
        </Link>
      </div>
    </>,
  );
}

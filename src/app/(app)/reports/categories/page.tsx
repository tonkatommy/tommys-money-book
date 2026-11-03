// Reports: where the money went, ranked, for one financial year.
//
// The plan named Recharts for this screen. It is a ranked bar *table* instead:
// ranks, labels, shares, amounts and server-rendered bars, for the reason §6
// of the 3c spec gives — a chart library would be client JavaScript bought
// for a picture, on the one screen whose entire value is the numbers.
//
// Income and expenses are two separate rankings rather than one list. They are
// different questions, and a salary and a phone bill sharing a bar scale is a
// screen with one visible bar.
//
// Side by side from 768px, as the Money Book canvas (ByCat.dc.html) draws
// them; stacked below. The two lists are uneven (around 8 income categories
// against 34 expense ones), so the income column ends early on a desktop; that
// is the accepted cost of seeing both totals at once. The phone overflow that
// once forced a single column came from a `1fr` track's min-content floor
// meeting a nowrap label; `.grid` columns are `minmax(0, 1fr)`, which has no
// such floor.
//
// A pure server component. No mutations, so no Server Actions and no forms.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EmptyState, Icon } from "@/components/ui/primitives";
import { RankedBars } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD } from "@/lib/money";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, rangeQuery, selectableFYs } from "@/lib/reports/fy";
import { getCategoryBreakdown, type CategoryTotal } from "@/lib/reports/query";
import { FyChip, FyLinks, QualityAlerts, ReportLinks } from "../parts";

export const dynamic = "force-dynamic";

export default async function ReportCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; fy?: string }>;
}) {
  const params = await searchParams;

  // One instant for the whole render, as on the index. Two calls to the clock
  // either side of NZ midnight would print a heading for one range over
  // figures for another.
  const now = new Date();

  // Parsed through the shared parser, never trusted. `?fy=1994` renders the
  // current year rather than a screenful of confident zeroes.
  const book = parseBook(params.book);
  const fy = parseFY(params.fy, now);

  // The shell header shows the pay period, which this screen does not use. It
  // shares this render's instant so the header cannot roll over to the next
  // period while the figures below stay in the previous one.
  const { period, settings } = await resolvePeriod(undefined, now);
  const view = await getCategoryBreakdown(book, fy, now);

  const years = selectableFYs(now);
  const bookName = book === "BUSINESS" ? "Business book" : "Personal book";

  // Every drilldown lands on the transaction list at THIS range, not at the
  // pay period it would otherwise default to. A total for one window opening
  // a list for another is how a figure gets doubted for no reason.
  const range = rangeQuery(fy, view.rangeEnd);

  const rows = (totals: CategoryTotal[]) =>
    totals.map((total) => ({
      key: total.categoryId,
      label: total.name,
      cents: total.totalCents,
      href: withBook(`/transactions?category=${total.categoryId}&${range}`, book),
      note: `${total.transactions} transaction${total.transactions === 1 ? "" : "s"}`,
    }));

  return (
    <AppShell
      active="reports"
      book={book}
      period={period}
      basePath="/reports/categories"
      preserveQuery={params.fy ? `fy=${fy.year}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <QualityAlerts quality={view.quality} book={book} fy={fy} rangeEnd={view.rangeEnd} />

      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">By category</h1>
          <span className="t-s ink2">
            {bookName} · income and expenses ranked separately. Transfers between
            your own accounts are neither, so they&apos;re in neither list.
          </span>
        </div>
        <FyLinks years={years} current={fy} book={book} basePath="/reports/categories" />
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <ReportLinks book={book} fy={fy} active="categories" />
        <FyChip fy={fy} rangeEnd={view.rangeEnd} />
      </div>

      <div className="grid cols-2" style={{ gap: 20, alignItems: "start" }}>
        <section className="txl" aria-label="Income">
          <div className="grp-h">
            <span className="dirl in">
              <Icon name="in" size="sm" />
              Money in · {view.income.length} categor{view.income.length === 1 ? "y" : "ies"}
            </span>
            <span className="m in">+{formatNZD(view.incomeCents)}</span>
          </div>
          <RankedBars
            rows={rows(view.income)}
            income
            empty={
              <div style={{ padding: 16 }}>
                <EmptyState
                  icon="in"
                  title="No income in this year"
                  body="Nothing in this book has been categorised as income for this range. If that's a surprise, it's usually the review queue rather than the year."
                />
              </div>
            }
          />
          {view.income.length > 0 && (
            <div className="rk tot">
              <span className="no" />
              <span className="n">Total</span>
              <span />
              <span className="p">100%</span>
              <span className="a m in">+{formatNZD(view.incomeCents)}</span>
            </div>
          )}
        </section>

        <section className="txl" aria-label="Expenses">
          <div className="grp-h">
            <span className="dirl out">
              <Icon name="out" size="sm" />
              Money out · {view.expenses.length} categor{view.expenses.length === 1 ? "y" : "ies"}
            </span>
            <span className="m">{formatNZD(view.expensesCents)}</span>
          </div>
          <RankedBars
            rows={rows(view.expenses)}
            empty={
              <div style={{ padding: 16 }}>
                <EmptyState
                  icon="out"
                  title="No spending in this year"
                  body="Nothing in this book has been categorised as an expense for this range."
                />
              </div>
            }
          />
          {view.expenses.length > 0 && (
            <div className="rk tot">
              <span className="no" />
              <span className="n">Total</span>
              <span />
              <span className="p">100%</span>
              <span className="a m">{formatNZD(view.expensesCents)}</span>
            </div>
          )}
        </section>
      </div>

      <p className="t-xs ink3">
        Shares are of each side&apos;s own total, so income and expenses never mix,
        and bars are scaled to the largest row on each side. Shares are rounded, so
        a column can add to 99% or 101%. Net for {fy.label}:{" "}
        <span className="num">
          {view.netCents >= 0 ? "+" : "−"}
          {formatNZD(Math.abs(view.netCents))}
        </span>
        .{" "}
        <Link href={withBook(`/reports/months?fy=${fy.year}`, book)}>
          See the same money month by month
        </Link>
      </p>
    </AppShell>
  );
}

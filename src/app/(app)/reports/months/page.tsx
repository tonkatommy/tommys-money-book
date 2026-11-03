// Reports: the Financial Breakdown sheet, live.
//
// Twelve calendar months across one financial year, with income, expenses and
// net. The table carries every figure. Above it sit plain CSS bars, drawn on
// the server from the same array, so the shape of the year reads at a glance
// without a chart library or a line of client JavaScript (§6 of the 3c spec
// rules a library out for this section; this isn't one).
//
// Calendar months here, 20th-to-19th pay periods on `/budget`. They are two
// different Augusts and always will be, so every row prints its literal date
// range beside its figures.
//
// A pure server component. Layout follows the Money Book canvas
// (Monthly.dc.html).

import { AppShell } from "@/components/app-shell";
import { Alert, Icon, Missing } from "@/components/ui/primitives";
import { formatNZD } from "@/lib/money";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, selectableFYs } from "@/lib/reports/fy";
import { getMonthlyBreakdown } from "@/lib/reports/query";
import { FyChip, FyLinks, QualityAlerts, ReportLinks } from "../parts";

export const dynamic = "force-dynamic";

const signed = (cents: number) => `${cents >= 0 ? "+" : "−"}${formatNZD(Math.abs(cents))}`;

export default async function ReportMonthsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; fy?: string }>;
}) {
  const params = await searchParams;

  // One instant for the whole render. Two reads of the clock either side of
  // NZ midnight would mark a different month as the partial one than the
  // figures were actually cut at.
  const now = new Date();

  const book = parseBook(params.book);
  const fy = parseFY(params.fy, now);

  // The shell header's pay period shares this render's instant, for the same
  // reason the figures do: one clock reading, or the two can disagree.
  const { period, settings } = await resolvePeriod(undefined, now);
  const view = await getMonthlyBreakdown(book, fy, now);

  const years = selectableFYs(now);
  const bookName = book === "BUSINESS" ? "Business book" : "Personal book";

  // A year with nothing in it at all is a real state — an FY selected before
  // the Akahu feed starts — and it says so once rather than printing twelve
  // convincing zero rows.
  const empty = view.transactions === 0;

  // Bars share one scale across in and out, so the two can be compared.
  const max = Math.max(
    1,
    ...view.months.map((m) => Math.max(m.incomeCents, m.expensesCents)),
  );
  const pct = (cents: number) => `${(Math.max(0, cents) / max) * 100}%`;

  return (
    <AppShell
      active="reports"
      book={book}
      period={period}
      basePath="/reports/months"
      preserveQuery={params.fy ? `fy=${fy.year}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <QualityAlerts quality={view.quality} book={book} fy={fy} rangeEnd={view.rangeEnd} />

      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Month by month</h1>
          <span className="t-s ink2">
            {bookName} · calendar months, 1st to last day. Not the Budget
            screen&apos;s months, which run 20th to 19th.
          </span>
        </div>
        <FyLinks years={years} current={fy} book={book} basePath="/reports/months" />
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <ReportLinks book={book} fy={fy} active="months" />
        <FyChip fy={fy} rangeEnd={view.rangeEnd} />
      </div>

      {empty && (
        <Alert level="info" title={`Nothing categorised in this book for ${fy.label}`}>
          The months below are the shape of the year, not a measurement of it.
          The bank feed may simply not reach back this far.
        </Alert>
      )}

      <section className="card pad-l stack" style={{ gap: 12 }} aria-label="Chart">
        <div className="row between wrap">
          <h2 className="t-m">Money in and out</h2>
          <div className="legend">
            <span>
              <span className="sw" style={{ background: "var(--in)" }} />
              In
            </span>
            <span>
              <span className="sw" style={{ background: "var(--ink-2)" }} />
              Out
            </span>
            <span>
              <span
                className="sw"
                style={{
                  background: "repeating-linear-gradient(135deg, var(--ink-3) 0 3px, transparent 3px 6px)",
                  border: "1px solid var(--ink-3)",
                }}
              />
              Partial month
            </span>
            <span>
              <span className="sw" style={{ border: "1px dashed var(--line-2)" }} />
              Not yet
            </span>
          </div>
        </div>
        <div
          className="vbars"
          style={{ height: 200, gap: 6 }}
          role="img"
          aria-label={`Money in and out by calendar month across ${fy.label}. Every figure is in the table below.`}
        >
          {view.months.map((m) => (
            <div key={m.label} className="g" style={{ gap: 2 }}>
              {m.future ? (
                <div
                  className="bar"
                  style={{ height: 30, border: "1px dashed var(--line-2)", borderBottom: 0 }}
                />
              ) : (
                <>
                  <div className={m.partial ? "bar part" : "bar ins"} style={{ height: pct(m.incomeCents) }} />
                  <div className={m.partial ? "bar part" : "bar outs"} style={{ height: pct(m.expensesCents) }} />
                </>
              )}
            </div>
          ))}
        </div>
        <div className="vlabels" style={{ gap: 6 }}>
          {view.months.map((m) => (
            <span key={m.label}>{m.label.slice(0, 3)}</span>
          ))}
        </div>
      </section>

      {/* Genuinely tabular, so it stays a table and scrolls sideways on a
          phone rather than being restacked into something harder to scan. */}
      <section className="card" style={{ padding: 0 }} aria-label="Every month">
        <div className="scroll">
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">
                  <span className="dirl in">
                    <Icon name="in" size="sm" />
                    In
                  </span>
                </th>
                <th className="num">
                  <span className="dirl out">
                    <Icon name="out" size="sm" />
                    Out
                  </span>
                </th>
                <th className="num">
                  <span className="dirl net">
                    <Icon name="net" size="sm" />
                    Net
                  </span>
                </th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {view.months.map((m) => (
                <tr key={m.label} className={m.partial ? "sub" : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className={m.future ? "ink3" : undefined}>{m.label}</span>
                    <div className="range">{m.range}</div>
                  </td>
                  {/* A future month is not a zero month. Printing $0.00
                      against February in August asserts something the app
                      cannot know. */}
                  {m.future ? (
                    <>
                      <td className="num">
                        <Missing>not yet</Missing>
                      </td>
                      <td className="num">
                        <Missing>not yet</Missing>
                      </td>
                      <td className="num">
                        <Missing>not yet</Missing>
                      </td>
                      <td />
                    </>
                  ) : (
                    <>
                      <td className="num m in">+{formatNZD(m.incomeCents)}</td>
                      <td className="num">{formatNZD(m.expensesCents)}</td>
                      <td className="num semi" style={{ color: m.netCents < 0 ? "var(--bad)" : undefined }}>
                        {signed(m.netCents)}
                      </td>
                      <td>
                        {m.partial ? (
                          <span className="badge b-pend">Partial · so far</span>
                        ) : (
                          <span className="t-s ink3">Complete</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              <tr className="tot">
                <td>
                  {fy.label}
                  <div className="range" style={{ fontWeight: 500 }}>
                    {view.rangeLabel}
                  </div>
                </td>
                <td className="num m in">+{formatNZD(view.incomeCents)}</td>
                <td className="num">{formatNZD(view.expensesCents)}</td>
                <td className="num" style={{ color: view.netCents < 0 ? "var(--bad)" : undefined }}>
                  {signed(view.netCents)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

// Reports: the financial year, and the GST threshold.
//
// This is the tax-question surface, not the "can I afford this today?" one.
// `/budget` answers the second and runs on a pay period; nothing here can,
// because the FY runs 01/04 to 31/03 and the GST window is a rolling twelve
// months, and both are facts about IRD rather than about the app.
//
// The consequence is the one risk this screen has to manage: August on the
// budget screen and August in a report are not the same August. So every
// figure below is printed with its literal date range beside it, in
// DD/MM/YYYY, the FY is drawn as a different shape of chip from the pay
// period, and the GST window gets a third.
//
// A pure server component. No mutations, so no Server Actions and no forms —
// the book toggle and the year selector are links, as everywhere else.
// Layout follows the Money Book canvas (Reports.dc.html).

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, selectableFYs } from "@/lib/reports/fy";
import { getReportsOverview } from "@/lib/reports/query";
import { FyChip, FyLinks, QualityAlerts, fyShort } from "./parts";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; fy?: string }>;
}) {
  const params = await searchParams;

  // One instant for the whole render. Every "now" below resolves through
  // `nzToday` before it becomes a date boundary, but three separate calls to
  // the clock could straddle NZ midnight and produce a heading for one range
  // over figures for another.
  const now = new Date();

  // Parsed, never trusted. `?fy=1994` would otherwise render a screenful of
  // confident zeroes, which reads exactly like a real answer.
  const book = parseBook(params.book);
  const fy = parseFY(params.fy, now);

  // The shell's header is the pay period, which this screen does not use. It
  // takes this render's instant rather than reading the clock for itself: it
  // awaits the database first, so its own `new Date()` would land a query
  // later than the one the figures were cut at.
  const { period, settings } = await resolvePeriod(undefined, now);
  const view = await getReportsOverview(book, fy, now);

  const years = selectableFYs(now);
  const bookName = book === "BUSINESS" ? "Business · Tommy Tinkers" : "Personal book";
  const link = (path: string) => withBook(`${path}?fy=${fy.year}`, book);

  return (
    <AppShell
      active="reports"
      book={book}
      period={period}
      basePath="/reports"
      preserveQuery={params.fy ? `fy=${fy.year}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <QualityAlerts quality={view.quality} book={book} fy={fy} rangeEnd={view.rangeEnd} />

      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Reports</h1>
          <span className="t-s ink2">
            {bookName} · reports run on the NZ financial year, not pay periods, so
            they won&apos;t match the Budget screens.
          </span>
        </div>
        <FyLinks years={years} current={fy} book={book} basePath="/reports" />
      </div>
      <FyChip fy={fy} rangeEnd={view.rangeEnd} />

      <div className="grid cols-3" style={{ gap: 16 }}>
        <div className="card pad-l stack" style={{ gap: 6 }}>
          <span className="dirl in">
            <Icon name="in" size="sm" />
            Money in
          </span>
          <span className="m in big">+{formatNZD(view.incomeCents)}</span>
          <span className="t-xs ink3">
            Income categories only. Transfers between your own accounts aren&apos;t income.
          </span>
        </div>
        <div className="card pad-l stack" style={{ gap: 6 }}>
          <span className="dirl out">
            <Icon name="out" size="sm" />
            Money out
          </span>
          <span className="m big">{formatNZD(view.expensesCents)}</span>
          <span className="t-xs ink3">Expense categories only.</span>
        </div>
        <div
          className="card pad-l stack"
          style={{ gap: 6, borderColor: "var(--ink)", borderWidth: 2 }}
        >
          <span className="dirl net">
            <Icon name="net" size="sm" />
            Net
          </span>
          <span className="m big" style={{ fontWeight: 800, color: view.netCents < 0 ? "var(--bad)" : undefined }}>
            {view.netCents >= 0 ? "+" : "−"}
            {formatNZD(Math.abs(view.netCents))}
          </span>
          <span className="t-xs ink3">Money in minus money out · {view.rangeLabel}</span>
        </div>
      </div>

      <div className="grid cols-main" style={{ gap: 20, alignItems: "start" }}>
        <section className="stack" style={{ gap: 12 }} aria-label="Reports">
          <h2 className="t-m">Reports for this year</h2>
          <Link className="card row" href={link("/reports/categories")} style={{ gap: 14 }}>
            <Icon name="chart" size="lg" />
            <span className="grow stack">
              <span className="semi">By category</span>
              <span className="t-s ink2">Income and spending ranked, with each one&apos;s share</span>
            </span>
            <Icon name="chev" />
          </Link>
          <Link className="card row" href={link("/reports/months")} style={{ gap: 14 }}>
            <Icon name="cal" size="lg" />
            <span className="grow stack">
              <span className="semi">Month by month</span>
              <span className="t-s ink2">12 calendar months of in, out and net</span>
            </span>
            <Icon name="chev" />
          </Link>
          <Link className="card row" href={link("/reports/ir3")} style={{ gap: 14 }}>
            <Icon name="doc" size="lg" />
            <span className="grow stack">
              <span className="semi">IR3 tax pack · FY {fyShort(fy)}</span>
              <span className="t-s ink2">Both books, ready for your accountant</span>
            </span>
            <Icon name="chev" />
          </Link>
        </section>

        {/* Business only. A rolling turnover figure against a registration
            threshold says nothing about the personal book, and a zero there
            would only invite the question of why it is zero. */}
        {view.gst ? (
          <section className="card pad-l stack" style={{ gap: 14 }} aria-label="GST registration monitor">
            <div className="row between wrap">
              <h2 className="t-m">GST registration monitor</h2>
              <span className="badge b-owner">
                <span className="bk b" aria-hidden="true" />
                Business
              </span>
            </div>
            <span className="cal mo sm" style={{ alignSelf: "flex-start" }}>
              <Icon name="cal" size="sm" />
              Rolling 12 months · {nzDate(view.gst.from)} – {nzDate(view.gst.to)}
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="m" style={{ fontSize: 28 }}>
                {formatNZD(view.gst.netCents)}
              </span>
              <span className="t-s ink2">
                Tommy Tinkers sales, of the{" "}
                <span className="num">{formatNZDWhole(view.gst.thresholdCents)}</span>{" "}
                threshold · {view.gst.transactions} sales counted
              </span>
            </div>
            <div
              className="meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={view.gst.thresholdCents / 100}
              aria-valuenow={view.gst.netCents / 100}
              aria-label="Sales against GST threshold"
            >
              <div
                className="fill"
                style={{ width: `${Math.min(100, Math.max(0, view.gst.fraction * 100))}%` }}
              />
              <div className="tick" style={{ left: "75%" }} />
            </div>
            <div className="row between range">
              <span>$0</span>
              <span>Tick = 75%</span>
              <span>{formatNZDWhole(view.gst.thresholdCents)}</span>
            </div>
            <p className="t-s">
              <span className="semi">
                {(view.gst.fraction * 100).toFixed(1)}% ·{" "}
                <span className="num">
                  {formatNZD(Math.max(0, view.gst.thresholdCents - view.gst.netCents))}
                </span>{" "}
                to go.
              </span>{" "}
              {view.gst.fraction >= 0.75 && (
                <span style={{ color: "var(--warn)" }}>
                  Past 75%: worth a word with your accountant.
                </span>
              )}
            </p>
            <p className="t-xs ink3">
              This window rolls daily and ignores the financial year, because
              that&apos;s how the threshold works. Business income only: money you
              put in yourself is owner money, not turnover.
            </p>
          </section>
        ) : (
          <section className="card pad-l stack" style={{ gap: 8 }} aria-label="GST">
            <h2 className="t-m">GST registration monitor</h2>
            <p className="t-s ink2">
              GST is about business turnover, so the monitor lives on the Business
              book.{" "}
              <Link href={withBook(`/reports?fy=${fy.year}`, "BUSINESS")}>Switch to Business</Link>
            </p>
          </section>
        )}
      </div>
    </AppShell>
  );
}

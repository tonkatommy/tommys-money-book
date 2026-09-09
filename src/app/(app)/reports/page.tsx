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
// DD/MM/YYYY, and the app-shell header keeps calling its own dates "Pay
// period" so the two are never read as the same thing.
//
// A pure server component. No mutations, so no Server Actions and no forms —
// the book toggle and the year selector are links, as everywhere else.

import { AppShell } from "@/components/app-shell";
import { Badge, Card } from "@/components/ui/primitives";
import { Figure, KV, PaceBar, ScreenHead } from "@/components/ui/data";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, selectableFYs } from "@/lib/reports/fy";
import { getReportsOverview } from "@/lib/reports/query";
import { FyLinks, QualityAlerts, ReportLinks } from "./parts";

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
  // is loaded anyway because the chrome is shared and the header labels it
  // "Pay period" — deliberately, so the two regimes stay visibly separate.
  const { period, settings } = await resolvePeriod();
  const view = await getReportsOverview(book, fy, now);

  const years = selectableFYs(now);

  return (
    <AppShell
      active="reports"
      book={book}
      period={period}
      basePath="/reports"
      preserveQuery={params.fy ? `fy=${fy.year}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Reports"
          sub={
            <>
              The tax year, not the pay period. These figures cover{" "}
              <strong>{view.rangeLabel}</strong> and will not match the budget
              screens, which run 20th to 19th.
            </>
          }
          right={
            <FyLinks
              years={years}
              current={fy}
              book={book}
              basePath="/reports"
            />
          }
        />

        <ReportLinks book={book} fy={fy} active="index" />

        <QualityAlerts
          quality={view.quality}
          book={book}
          fy={fy}
          rangeEnd={view.rangeEnd}
        />

        <Card
          title={`${fy.label} so far`}
          action={
            <span
              className="mb-num"
              style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
            >
              {view.rangeLabel}
            </span>
          }
        >
          <div className="mb-grid-tight">
            <Figure
              label="Money in"
              value={formatNZD(view.incomeCents)}
              tone="var(--money-in)"
              note="income categories only — transfers between your own accounts are not income"
            />
            <Figure
              label="Money out"
              value={formatNZD(view.expensesCents)}
              tone="var(--money-out)"
              note="expense categories only"
            />
          </div>

          <div
            style={{
              marginTop: "var(--space-5)",
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <KV
              label={`Net for ${fy.label}`}
              value={formatNZD(view.netCents)}
              tone={
                view.netCents >= 0 ? "var(--money-in)" : "var(--status-error)"
              }
            />
          </div>
        </Card>

        {/* Business only. A rolling turnover figure against a registration
            threshold says nothing about the personal book, and a zero there
            would only invite the question of why it is zero. */}
        {view.gst && (
          <Card
            title="GST registration monitor"
            action={
              <Badge tone={view.gst.fraction >= 0.75 ? "warning" : "ok"}>
                {Math.round(view.gst.fraction * 100)}% of threshold
              </Badge>
            }
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: "var(--space-4)",
              }}
            >
              <span className="mb-figure-md mb-num">
                {formatNZD(view.gst.netCents)}
              </span>
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-tertiary)",
                }}
              >
                of {formatNZDWhole(view.gst.thresholdCents)}
              </span>
            </div>

            <PaceBar
              spentCents={view.gst.netCents}
              budgetCents={view.gst.thresholdCents}
              tone={view.gst.fraction >= 0.75 ? "warning" : "accent"}
            />

            <div
              style={{
                marginTop: "var(--space-4)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <KV
                label="12 months to"
                value={nzDate(view.gst.to)}
                mono={false}
              />
              <KV
                label="Window opens"
                value={nzDate(view.gst.from)}
                mono={false}
              />
              <KV
                label="Sales counted"
                value={`${view.gst.transactions}`}
              />
            </div>

            <p
              style={{
                margin: "var(--space-4) 0 0",
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              Registration is triggered by turnover in the <em>past</em> twelve
              months, so this window moves every day and is not the financial
              year above. Business income only — money you put into the
              business yourself is an owner contribution and is not turnover.
            </p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

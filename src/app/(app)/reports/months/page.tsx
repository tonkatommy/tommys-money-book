// Reports: the Financial Breakdown sheet, live.
//
// Twelve calendar months across one financial year, with income, expenses and
// net. A table rather than a chart, and deliberately: three series at phone
// width read better as three columns of numbers than as anything drawn, and
// §6 of the 3c spec rules out a chart library for the whole section anyway.
//
// Calendar months here, 20th-to-19th pay periods on `/budget`. They are two
// different Augusts and always will be, so every row prints its literal date
// range beside its figures.
//
// A pure server component. The year selector and the book toggle are links,
// so the screen works with JavaScript disabled.

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/primitives";
import { Figure, KV, ScreenHead } from "@/components/ui/data";
import { formatNZD } from "@/lib/money";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, selectableFYs } from "@/lib/reports/fy";
import { getMonthlyBreakdown } from "@/lib/reports/query";
import { FyLinks, QualityAlerts, ReportLinks } from "../parts";

export const dynamic = "force-dynamic";

const cell = { padding: "10px 14px 10px 0" } as const;
const numeric = { ...cell, textAlign: "right" } as const;

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

  const { period, settings } = await resolvePeriod();
  const view = await getMonthlyBreakdown(book, fy, now);

  const years = selectableFYs(now);

  // A year with nothing in it at all is a real state — an FY selected before
  // the Akahu feed starts — and it says so once rather than printing twelve
  // convincing zero rows.
  const empty = view.transactions === 0;

  return (
    <AppShell
      active="reports"
      book={book}
      period={period}
      basePath="/reports/months"
      preserveQuery={params.fy ? `fy=${fy.year}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Month by month"
          sub={
            <>
              Calendar months across <strong>{view.rangeLabel}</strong>. These
              are not the budget screen&apos;s months — that runs 20th to 19th,
              and the two will never agree.
            </>
          }
          right={
            <FyLinks
              years={years}
              current={fy}
              book={book}
              basePath="/reports/months"
            />
          }
        />

        <ReportLinks book={book} fy={fy} active="months" />

        <QualityAlerts
          quality={view.quality}
          book={book}
          fy={fy}
          rangeEnd={view.rangeEnd}
        />

        <Card
          title={`${fy.label} totals`}
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
              note="income categories only"
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

        <Card title="Every month">
          {empty && (
            <p
              style={{
                margin: "0 0 var(--space-4)",
                fontSize: "var(--text-sm)",
                color: "var(--text-tertiary)",
              }}
            >
              Nothing categorised in this book for {fy.label}. The months below
              are the shape of the year, not a measurement of it — the bank
              feed may simply not reach back this far.
            </p>
          )}

          {/* Genuinely tabular, so it stays a table and scrolls sideways on a
              phone rather than being restacked into something harder to scan.
              Same treatment as the sync run log. */}
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
                  <th style={cell}>Month</th>
                  {/* The literal range, on every row. This is the phase's
                      whole mitigation for carrying two date regimes. */}
                  <th style={cell}>Range</th>
                  <th style={numeric}>In</th>
                  <th style={numeric}>Out</th>
                  <th style={numeric}>Net</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--text-secondary)" }}>
                {view.months.map((month) => (
                  <tr
                    key={month.label}
                    style={{
                      borderTop: "1px solid var(--border-subtle)",
                      // A month that has not happened is drawn faint, the
                      // same way DayBars draws the rest of a pay period.
                      opacity: month.future ? 0.45 : 1,
                    }}
                  >
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      {month.label}
                      {month.partial && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: "var(--text-xs)",
                            color: "var(--text-muted)",
                          }}
                        >
                          so far
                        </span>
                      )}
                    </td>
                    <td
                      className="mb-num"
                      style={{
                        ...cell,
                        whiteSpace: "nowrap",
                        fontSize: "var(--text-xs)",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {month.range}
                    </td>

                    {/* A future month is not a zero month. Printing $0.00
                        against February in August asserts something the app
                        cannot know; an em dash says "not yet", which is the
                        truth and is also what the reader would have assumed. */}
                    {month.future ? (
                      <td
                        colSpan={3}
                        style={{
                          ...numeric,
                          color: "var(--text-muted)",
                          fontSize: "var(--text-xs)",
                        }}
                      >
                        not yet
                      </td>
                    ) : (
                      <>
                        <td
                          className="mb-num"
                          style={{
                            ...numeric,
                            color:
                              month.incomeCents === 0
                                ? "var(--text-muted)"
                                : "var(--money-in)",
                          }}
                        >
                          {formatNZD(month.incomeCents)}
                        </td>
                        <td
                          className="mb-num"
                          style={{
                            ...numeric,
                            color:
                              month.expensesCents === 0
                                ? "var(--text-muted)"
                                : "var(--money-out)",
                          }}
                        >
                          {formatNZD(month.expensesCents)}
                        </td>
                        <td
                          className="mb-num"
                          style={{
                            ...numeric,
                            color:
                              month.transactions === 0
                                ? "var(--text-muted)"
                                : month.netCents >= 0
                                  ? "var(--text-primary)"
                                  : "var(--status-error)",
                          }}
                        >
                          {formatNZD(month.netCents)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr
                  style={{
                    borderTop: "1px solid var(--border-default)",
                    color: "var(--text-primary)",
                    fontWeight: "var(--weight-semibold)",
                  }}
                >
                  <td style={cell}>{fy.label}</td>
                  <td
                    className="mb-num"
                    style={{
                      ...cell,
                      whiteSpace: "nowrap",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-tertiary)",
                      fontWeight: "var(--weight-medium)",
                    }}
                  >
                    {view.rangeLabel}
                  </td>
                  <td className="mb-num" style={numeric}>
                    {formatNZD(view.incomeCents)}
                  </td>
                  <td className="mb-num" style={numeric}>
                    {formatNZD(view.expensesCents)}
                  </td>
                  <td className="mb-num" style={numeric}>
                    {formatNZD(view.netCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

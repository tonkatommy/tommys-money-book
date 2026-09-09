// Reports: where the money went, ranked, for one financial year.
//
// The plan named Recharts for this screen. It is a ranked bar *table* instead:
// labels, amounts, shares and server-rendered bars, for the reason §6 of the
// 3c spec gives — a chart library would be the first client JavaScript in the
// app, bought for a picture, on the one screen whose entire value is the
// numbers themselves.
//
// Income and expenses are two separate rankings rather than one list. They are
// different questions, and a salary and a phone bill sharing a bar scale is a
// screen with one visible bar.
//
// A pure server component, like every screen in this section. No mutations, so
// no Server Actions and no forms: the book toggle and the year selector are
// links, and the whole screen works with JavaScript disabled.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Figure, KV, RankedBars, ScreenHead } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD } from "@/lib/money";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, selectableFYs } from "@/lib/reports/fy";
import {
  getCategoryBreakdown,
  type CategoryTotal,
} from "@/lib/reports/query";
import { FyLinks, QualityAlerts, ReportLinks, rangeQuery } from "../parts";

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
  // stays labelled "Pay period" precisely so the two date regimes never read
  // as the same thing.
  const { period, settings } = await resolvePeriod();
  const view = await getCategoryBreakdown(book, fy, now);

  const years = selectableFYs(now);

  // Every drilldown lands on the transaction list at THIS range, not at the
  // pay period it would otherwise default to. A total for one window opening
  // a list for another is how a figure gets doubted for no reason.
  const range = rangeQuery(fy, view.rangeEnd);

  const rows = (totals: CategoryTotal[]) =>
    totals.map((total) => ({
      key: total.categoryId,
      label: total.name,
      cents: total.totalCents,
      href: withBook(
        `/transactions?category=${total.categoryId}&${range}`,
        book,
      ),
      note: `${total.transactions} transaction${
        total.transactions === 1 ? "" : "s"
      }`,
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
      <div className="mb-stack">
        <ScreenHead
          title="By category"
          sub={
            <>
              Every income and expense category for{" "}
              <strong>{view.rangeLabel}</strong>. Transfers between your own
              accounts are not here, and never were — they are neither income
              nor spending.
            </>
          }
          right={
            <FyLinks
              years={years}
              current={fy}
              book={book}
              basePath="/reports/categories"
            />
          }
        />

        <ReportLinks book={book} fy={fy} active="categories" />

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
              note={`${view.income.length} income categor${
                view.income.length === 1 ? "y" : "ies"
              }`}
            />
            <Figure
              label="Money out"
              value={formatNZD(view.expensesCents)}
              tone="var(--money-out)"
              note={`${view.expenses.length} expense categor${
                view.expenses.length === 1 ? "y" : "ies"
              }`}
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

        {/* Two cards, two RankedBars, two independent scales. Each side's
            bars are scaled against its own largest row, and each percentage
            is a share of its own side — mixing them would make every expense
            a hairline next to a year of salary. */}
        <div className="mb-grid mb-grid-split">
          <Card
            title="Money in"
            action={
              <span
                style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
              >
                largest first
              </span>
            }
          >
            <RankedBars
              rows={rows(view.income)}
              tone="var(--money-in)"
              empty={
                <EmptyState
                  compactPad
                  icon="↓"
                  title="No income in this year"
                  body="Nothing in this book has been categorised as income for this range. If that is a surprise, it is usually the review queue rather than the year."
                />
              }
            />
          </Card>

          <Card
            title="Money out"
            action={
              <span
                style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
              >
                largest first
              </span>
            }
          >
            <RankedBars
              rows={rows(view.expenses)}
              tone="var(--money-out)"
              empty={
                <EmptyState
                  compactPad
                  icon="↑"
                  title="No spending in this year"
                  body="Nothing in this book has been categorised as an expense for this range."
                />
              }
            />
          </Card>
        </div>

        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-sans)",
          }}
        >
          Bars are scaled against the largest category on their own side, so
          the two halves of this screen are not comparable to each other. The
          percentages are each category&apos;s share of its own side.{" "}
          <Link href={withBook(`/reports/months?fy=${fy.year}`, book)}>
            See the same money month by month
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}

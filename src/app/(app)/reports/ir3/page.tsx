// /reports/ir3 — the IR3 pack.
//
// The one reports screen that does not take a `book` filter. An IR3 return
// is a single document covering both books at once: rental and other
// personal income sit in PERSONAL, the business summary in BUSINESS, and the
// home office deduction spans both by tax tag rather than by book (Phase 4a
// spec §4). The book toggle in the header still renders, because every
// other screen has one and a page that silently drops shared chrome is its
// own kind of surprise, but it does nothing here — the copy below says so.
//
// Every warning `computeRentalFigures`/`computeBusinessFigures` returns
// (reports/ir3.ts) renders as its own Alert, on top of the usual
// QualityAlerts for both books. An IR3 figure quietly short by an unentered
// management fee is this app's characteristic failure on the one screen an
// accountant will actually read, so it gets the loudest treatment in the
// app for exactly that reason.

import { AppShell } from "@/components/app-shell";
import { Alert, ButtonLink, Card } from "@/components/ui/primitives";
import { Figure, KV, ScreenHead } from "@/components/ui/data";
import { formatNZD } from "@/lib/money";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, selectableFYs } from "@/lib/reports/fy";
import { getIr3Pack } from "@/lib/reports/query";
import { HOME_OFFICE_RATE } from "@/lib/reports/ir3";
import { FyLinks, QualityAlerts, ReportLinks } from "../parts";
import { AdjustmentsForm } from "./forms";

export const dynamic = "force-dynamic";

function ExpenseLineRow({
  name,
  totalCents,
  hint,
}: {
  name: string;
  totalCents: number;
  hint?: string;
}) {
  return (
    <KV
      label={hint ? `${name} (${hint})` : name}
      value={formatNZD(totalCents)}
    />
  );
}

export default async function Ir3Page({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; fy?: string }>;
}) {
  const params = await searchParams;

  // One instant for the whole render — see reports/page.tsx for why.
  const now = new Date();

  const book = parseBook(params.book);
  const fy = parseFY(params.fy, now);

  const { period, settings } = await resolvePeriod(undefined, now);
  const pack = await getIr3Pack(fy, now);

  const years = selectableFYs(now);
  const { rental, business, homeOffice, taxableIncome } = pack;

  return (
    <AppShell
      active="reports"
      book={book}
      period={period}
      basePath="/reports/ir3"
      preserveQuery={params.fy ? `fy=${fy.year}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="IR3 pack"
          sub={
            <>
              Covers both books at once for {pack.rangeLabel} — the book
              toggle above does not change this screen. Figures here are a
              starting point for the return, not a filed one; caveats below
              flag what still needs Garreth&rsquo;s confirmation.
            </>
          }
          right={<FyLinks years={years} current={fy} book={book} basePath="/reports/ir3" />}
        />

        <ReportLinks book={book} fy={fy} active="ir3" />

        <QualityAlerts
          quality={pack.personalQuality}
          book="PERSONAL"
          fy={fy}
          rangeEnd={pack.rangeEnd}
        />
        <QualityAlerts
          quality={pack.businessQuality}
          book="BUSINESS"
          fy={fy}
          rangeEnd={pack.rangeEnd}
        />

        {rental.warnings.map((warning, index) => (
          <Alert key={`rental-warning-${index}`} level="warning">
            {warning}
          </Alert>
        ))}

        <Card title="Rental — Cashel St">
          <div className="mb-grid-tight" style={{ marginBottom: "var(--space-5)" }}>
            <Figure
              label="Gross rental income"
              value={formatNZD(rental.grossIncomeCents)}
              tone="var(--money-in)"
              note={
                rental.managementFeeEntered
                  ? `net rent ${formatNZD(rental.netRentReceivedCents)} + management fee ${formatNZD(rental.managementFeeCents)}`
                  : "net rent received, per the bank feed — management fee not entered"
              }
            />
            <Figure
              label="Deductible expenses"
              value={formatNZD(rental.deductibleExpenseCents)}
              tone="var(--money-out)"
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              marginBottom: "var(--space-4)",
            }}
          >
            {rental.expenseLines.map((line) => (
              <ExpenseLineRow
                key={line.name}
                name={line.name}
                totalCents={
                  line.isMortgage ? rental.mortgageInterestUsedCents : line.totalCents
                }
                hint={
                  line.isMortgage
                    ? rental.mortgageInterestCents !== null
                      ? `interest only — ${formatNZD(rental.mortgagePrincipalCents)} principal (not deductible) of ${formatNZD(rental.mortgagePaymentsCents)} paid`
                      : "excluded — interest not entered"
                    : line.fromAdjustment
                      ? "from the adjustment below"
                      : undefined
                }
              />
            ))}
          </div>

          <div
            style={{
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <KV
              label="Net rental result"
              value={formatNZD(rental.netCents)}
              tone={rental.netCents >= 0 ? "var(--money-in)" : "var(--status-error)"}
            />
          </div>
        </Card>

        {business.caveats.map((caveat, index) => (
          <Alert key={`business-caveat-${index}`} level="warning">
            {caveat}
          </Alert>
        ))}

        <Card title="Tommy Tinkers">
          <div className="mb-grid-tight" style={{ marginBottom: "var(--space-5)" }}>
            <Figure
              label="Business income"
              value={formatNZD(business.incomeCents)}
              tone="var(--money-in)"
            />
            <Figure
              label="Business expenses"
              value={formatNZD(business.expensesCents)}
              tone="var(--money-out)"
              note={
                business.entertainmentCents > 0
                  ? `includes ${formatNZD(business.entertainmentCents)} entertainment, at full value`
                  : undefined
              }
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              marginBottom: "var(--space-4)",
            }}
          >
            <p style={{ margin: "0 0 2px", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Income
            </p>
            {business.incomeLines.map((line) => (
              <ExpenseLineRow key={line.name} name={line.name} totalCents={line.totalCents} />
            ))}

            <p style={{ margin: "var(--space-3) 0 2px", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Expenses
            </p>
            {business.expenseLines.map((line) => (
              <ExpenseLineRow
                key={line.name}
                name={line.name}
                // Positive, matching the app's display convention (invariant
                // 2) — expenses are shown positive everywhere, including the
                // Figure above; a sign flip here would be the "second flip"
                // that convention exists to rule out.
                totalCents={line.totalCents}
                hint={line.isEntertainment ? "50% limit not applied — confirm" : undefined}
              />
            ))}
          </div>

          <div
            style={{
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <KV
              label="Net business result"
              value={formatNZD(business.netCents)}
              tone={business.netCents >= 0 ? "var(--money-in)" : "var(--status-error)"}
            />
          </div>

          <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            GST turnover monitor lives on the <a href={`/reports?book=BUSINESS&fy=${fy.year}`}>overview</a> screen, not repeated here.
          </p>
        </Card>

        {homeOffice.caveats.map((caveat, index) => (
          <Alert key={`home-office-caveat-${index}`} level="warning">
            {caveat}
          </Alert>
        ))}

        <Card title="Home office">
          <div className="mb-grid-tight" style={{ marginBottom: "var(--space-4)" }}>
            <Figure
              label="Eligible costs"
              value={formatNZD(homeOffice.eligibleCents)}
              note="rent, power, internet & phone, water — the four home-office categories"
            />
            <Figure
              label={`Deduction at ${(HOME_OFFICE_RATE * 100).toFixed(2)}%`}
              value={formatNZD(homeOffice.deductionCents)}
              tone="var(--money-in)"
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {homeOffice.lines.map((line) => (
              <ExpenseLineRow key={line.name} name={line.name} totalCents={line.totalCents} />
            ))}
          </div>
        </Card>

        {taxableIncome.caveats.map((caveat, index) => (
          <Alert key={`taxable-caveat-${index}`} level="warning">
            {caveat}
          </Alert>
        ))}

        <Card title="Other taxable income">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
            {taxableIncome.lines.map((line) => (
              <ExpenseLineRow key={line.name} name={line.name} totalCents={line.totalCents} />
            ))}
          </div>
          <div style={{ paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
            <KV label="Total" value={formatNZD(taxableIncome.totalCents)} />
          </div>
        </Card>

        <AdjustmentsForm
          fyLabel={fy.label}
          rentalManagementFeeCents={pack.adjustment.rentalManagementFeeCents}
          rentalMortgageInterestCents={pack.adjustment.rentalMortgageInterestCents}
        />

        <Card title="Export">
          <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            Everything above, laid out as a workbook to forward to Garreth.
          </p>
          <ButtonLink href={`/reports/ir3/export?fy=${fy.year}`} variant="primary" size="sm">
            Download IR3 pack ({fy.label}.xlsx)
          </ButtonLink>
        </Card>
      </div>
    </AppShell>
  );
}

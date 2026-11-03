// /reports/ir3 — the IR3 pack.
//
// The one reports screen that does not take a `book` filter. An IR3 return
// is a single document covering both books at once: rental and other
// personal income sit in PERSONAL, the business summary in BUSINESS, and the
// home office deduction spans both by tax tag rather than by book (Phase 4a
// spec §4). So the header shows a locked "Both books" label instead of the
// toggle: a control that looks live and does nothing is worse than none.
//
// Drawn as a document (IR3.dc.html): numbered sections on paper, because this
// is the page handed to an accountant and should read like one.
//
// Every rental warning `computeRentalFigures` returns (reports/ir3.ts) renders
// as its own banner ABOVE the document, on top of the usual QualityAlerts for
// both books. An IR3 figure quietly short by an unentered management fee is
// this app's characteristic failure on the one screen an accountant will
// actually read, so it gets the loudest treatment in the app. The business,
// home office and income caveats are questions rather than gaps, so they're
// collected into the document's own "questions for the accountant" section.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Alert, Icon, Missing } from "@/components/ui/primitives";
import { formatNZD } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { parseFY, selectableFYs } from "@/lib/reports/fy";
import { getIr3Pack } from "@/lib/reports/query";
import { HOME_OFFICE_RATE } from "@/lib/reports/ir3";
import { FyChip, FyLinks, QualityAlerts, ReportLinks, fyShort } from "../parts";
import { AdjustmentsForm } from "./forms";

export const dynamic = "force-dynamic";

const indent = { paddingLeft: 24 } as const;

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

  const blanks =
    (pack.adjustment.rentalManagementFeeCents === null ? 1 : 0) +
    (pack.adjustment.rentalMortgageInterestCents === null ? 1 : 0);
  const questions = [...business.caveats, ...homeOffice.caveats, ...taxableIncome.caveats];
  const partial = pack.rangeEnd.getTime() < fy.end.getTime();
  const ratePct = `${(HOME_OFFICE_RATE * 100).toFixed(2)}%`;

  return (
    <AppShell
      active="ir3"
      book={book}
      period={period}
      basePath="/reports/ir3"
      preserveQuery={params.fy ? `fy=${fy.year}` : undefined}
      splitFortnightly={settings.splitFortnightly}
      lockBook="both"
    >
      <div className="stack" style={{ gap: 16, width: "100%", maxWidth: 1080 }}>
        {blanks > 0 && (
          <Alert
            level="error"
            title={`${blanks} rental figure${blanks === 1 ? " is" : "s are"} blank, so this pack isn't finished`}
            affects="Incomplete: section 1 · Rental"
            actions={
              <a className="btn sm" href="#bank-cant-see">
                Enter {blanks === 1 ? "the figure" : `the ${blanks} figures`}
              </a>
            }
          >
            The bank can&apos;t see the management fee or the mortgage interest.
          </Alert>
        )}
        {rental.warnings.map((warning, index) => (
          <Alert key={`rental-warning-${index}`}>{warning}</Alert>
        ))}
        <QualityAlerts quality={pack.personalQuality} book="PERSONAL" fy={fy} rangeEnd={pack.rangeEnd} nameBook />
        <QualityAlerts quality={pack.businessQuality} book="BUSINESS" fy={fy} rangeEnd={pack.rangeEnd} nameBook />

        <div className="page-h">
          <div className="grow stack" style={{ gap: 6 }}>
            <h1 className="t-xl">IR3 tax pack</h1>
            <span className="t-s ink2">
              Everything your accountant needs for one year, from both books.
            </span>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <FyLinks years={years} current={fy} book={book} basePath="/reports/ir3" />
            <a className="btn primary" href={`/reports/ir3/export?fy=${fy.year}`}>
              <Icon name="dl" size="sm" />
              Export .xlsx
            </a>
          </div>
        </div>
        <ReportLinks book={book} fy={fy} active="ir3" />

        <article className="doc">
          <header className="doc-sec stack" style={{ gap: 12 }}>
            <div className="row between wrap" style={{ gap: 12 }}>
              <span className="lbl">Individual income tax return · IR3</span>
              {blanks > 0 ? (
                <span className="badge b-bad">Incomplete · {blanks} blank</span>
              ) : partial ? (
                <span className="badge b-warn">Year still running</span>
              ) : (
                <span className="badge b-ok">Figures complete</span>
              )}
            </div>
            <h2 className="t-xl">Year ended 31 March {fy.year}</h2>
            <FyChip fy={fy} rangeEnd={pack.rangeEnd} />
            <div className="grid cols-3" style={{ gap: 12, marginTop: 4 }}>
              <div className="stack">
                <span className="t-xs ink3">Prepared</span>
                <span className="num t-s">{nzDate(now)}</span>
              </div>
              <div className="stack">
                <span className="t-xs ink3">Books</span>
                <span className="t-s">
                  <span className="bk p" aria-hidden="true" /> Personal ·{" "}
                  <span className="bk b" aria-hidden="true" /> Tommy Tinkers
                </span>
              </div>
              <div className="stack">
                <span className="t-xs ink3">Coverage</span>
                <span className="t-s">{pack.rangeLabel}</span>
              </div>
            </div>
          </header>

          <section className="doc-sec" aria-label="Rental">
            <div className="doc-h">
              <span className="no">1</span>
              <h2>Rental · Cashel St</h2>
              <span className="badge">
                <span className="bk p" aria-hidden="true" />
                Personal · tax tag Rental
              </span>
            </div>
            <table className="tbl tight">
              <tbody>
                <tr>
                  <td>
                    Rent received
                    <div className="t-xs ink3">
                      {rental.managementFeeEntered
                        ? `Net rent ${formatNZD(rental.netRentReceivedCents)} + management fee ${formatNZD(rental.managementFeeCents)}`
                        : "Net rent per the bank feed. Gross needs the management fee added back."}
                    </div>
                  </td>
                  <td className="num m in">+{formatNZD(rental.grossIncomeCents)}</td>
                </tr>
                {rental.expenseLines.map((line) => (
                  <tr key={line.name}>
                    <td className="ink2" style={indent}>
                      {line.name}
                      {line.fromAdjustment && (
                        <span className="prov hand" style={{ marginLeft: 6 }}>
                          <Icon name="pen" />
                          You enter
                        </span>
                      )}
                      {line.isMortgage && rental.mortgageInterestCents !== null && (
                        <div className="t-xs ink3">
                          Interest only: {formatNZD(rental.mortgagePrincipalCents)} principal
                          (not deductible) of {formatNZD(rental.mortgagePaymentsCents)} paid
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {line.isMortgage && rental.mortgageInterestCents === null ? (
                        <span className="badge b-bad">not entered · excluded</span>
                      ) : (
                        formatNZD(line.isMortgage ? rental.mortgageInterestUsedCents : line.totalCents)
                      )}
                    </td>
                  </tr>
                ))}
                {!rental.managementFeeEntered && (
                  <tr>
                    <td className="ink2" style={indent}>
                      Property management fee
                      <span className="prov hand" style={{ marginLeft: 6 }}>
                        <Icon name="pen" />
                        You enter
                      </span>
                    </td>
                    <td className="num">
                      <span className="badge b-bad">not entered</span>
                    </td>
                  </tr>
                )}
                <tr className="sub">
                  <td>Deductible expenses</td>
                  <td className="num">
                    {blanks > 0 ? (
                      <>
                        {formatNZD(rental.deductibleExpenseCents)}{" "}
                        <Missing>incomplete</Missing>
                      </>
                    ) : (
                      formatNZD(rental.deductibleExpenseCents)
                    )}
                  </td>
                </tr>
                <tr className="tot">
                  <td>Net rental result</td>
                  <td className="num" style={{ color: rental.netCents < 0 ? "var(--bad)" : undefined }}>
                    {rental.netCents >= 0 ? "+" : "−"}
                    {formatNZD(Math.abs(rental.netCents))}
                    {blanks > 0 && (
                      <div className="t-xs" style={{ color: "var(--bad)", fontWeight: 600 }}>
                        not final until the blanks are entered
                      </div>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>

            <AdjustmentsForm
              fyLabel={fy.label}
              rentalManagementFeeCents={pack.adjustment.rentalManagementFeeCents}
              rentalMortgageInterestCents={pack.adjustment.rentalMortgageInterestCents}
            />
          </section>

          <section className="doc-sec" aria-label="Sole trader">
            <div className="doc-h">
              <span className="no">2</span>
              <h2>Sole trader · Tommy Tinkers</h2>
              <span className="badge b-owner">
                <span className="bk b" aria-hidden="true" />
                Business book
              </span>
            </div>
            <table className="tbl tight">
              <tbody>
                {business.incomeLines.map((line) => (
                  <tr key={line.name}>
                    <td>{line.name}</td>
                    <td className="num m in">+{formatNZD(line.totalCents)}</td>
                  </tr>
                ))}
                <tr className="sub">
                  <td>Business income</td>
                  <td className="num">+{formatNZD(business.incomeCents)}</td>
                </tr>
                {business.expenseLines.map((line) => (
                  <tr key={line.name}>
                    <td className="ink2" style={indent}>
                      {line.name}
                      {line.isEntertainment && (
                        <span className="badge b-warn" style={{ marginLeft: 6 }}>
                          50% limit not applied · confirm
                        </span>
                      )}
                    </td>
                    {/* Positive, matching the app's display convention
                        (invariant 2): expenses are shown positive everywhere,
                        so a sign flip here would be the "second flip" that
                        convention exists to rule out. */}
                    <td className="num">{formatNZD(line.totalCents)}</td>
                  </tr>
                ))}
                <tr className="sub">
                  <td>Business expenses</td>
                  <td className="num">{formatNZD(business.expensesCents)}</td>
                </tr>
                <tr className="tot">
                  <td>Net business result</td>
                  <td className="num" style={{ color: business.netCents < 0 ? "var(--bad)" : undefined }}>
                    {business.netCents >= 0 ? "+" : "−"}
                    {formatNZD(Math.abs(business.netCents))}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="t-xs ink3" style={{ marginTop: 10 }}>
              The GST turnover monitor is on the{" "}
              <Link href={`/reports?book=BUSINESS&fy=${fy.year}`}>Reports overview</Link>,
              not repeated here.
            </p>
          </section>

          <section className="doc-sec" aria-label="Other income">
            <div className="doc-h">
              <span className="no">3</span>
              <h2>Other taxable income</h2>
            </div>
            <table className="tbl tight">
              <tbody>
                {taxableIncome.lines.map((line) => (
                  <tr key={line.name}>
                    <td>{line.name}</td>
                    <td className="num m in">+{formatNZD(line.totalCents)}</td>
                  </tr>
                ))}
                {taxableIncome.lines.length === 0 && (
                  <tr>
                    <td className="ink2">Nothing tagged as other taxable income</td>
                    <td className="num">
                      <Missing>none</Missing>
                    </td>
                  </tr>
                )}
                <tr className="tot">
                  <td>Total</td>
                  <td className="num">+{formatNZD(taxableIncome.totalCents)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="doc-sec" aria-label="Home office">
            <div className="doc-h">
              <span className="no">4</span>
              <h2>Home office</h2>
              <span className="t-s ink2">Eligible costs × {ratePct}</span>
              {homeOffice.rateUnconfirmed && (
                <span className="badge b-warn">Rate unconfirmed for {fy.label}</span>
              )}
            </div>
            <table className="tbl tight">
              <tbody>
                {homeOffice.lines.map((line) => (
                  <tr key={line.name}>
                    <td className="ink2">{line.name}</td>
                    <td className="num">{formatNZD(line.totalCents)}</td>
                  </tr>
                ))}
                <tr className="sub">
                  <td>Eligible costs</td>
                  <td className="num">{formatNZD(homeOffice.eligibleCents)}</td>
                </tr>
                <tr className="tot">
                  <td>Deduction at {ratePct}</td>
                  <td className="num">{formatNZD(homeOffice.deductionCents)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="doc-sec" aria-label="Caveats and questions">
            <div className="doc-h">
              <span className="no">5</span>
              <h2>Caveats and questions for the accountant</h2>
            </div>
            {questions.length === 0 ? (
              <p className="t-s ink2">No open questions flagged for {fy.label}.</p>
            ) : (
              <ol className="stack t-s" style={{ gap: 10, margin: 0, paddingLeft: 22 }}>
                {questions.map((q, i) => (
                  <li key={i} className="ink2">
                    {q}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </article>
        <p className="t-xs ink3">
          Money Book prepares figures from your bank data. It isn&apos;t tax advice;
          your accountant decides what goes on the return. FY {fyShort(fy)} export:{" "}
          <a href={`/reports/ir3/export?fy=${fy.year}`}>{fy.label}.xlsx</a>
        </p>
      </div>
    </AppShell>
  );
}

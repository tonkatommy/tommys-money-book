// The chrome every reports screen shares: the year selector, the FY chip, the
// completeness warnings, and the links between the four reports.
//
// A file of its own rather than four copies, because §5 of the 3c spec makes
// the warnings a requirement on *every* reports screen, not just the index —
// and a requirement repeated in four places is a requirement that will end up
// worded four ways and wired to four different date ranges. The count and
// the list behind it have to describe the same window, or a cleared queue
// still shows six.
//
// The FY is drawn as a square tab with a bookmark (`.cal.fy`), never the pay
// period's round pill: the two calendars must not be readable as one.
//
// Server components. Everything here is links, so the section keeps working
// with JavaScript disabled.

import Link from "next/link";
import type { Book } from "@/generated/prisma/client";
import { Alert, CalendarChip } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { nzDate } from "@/lib/budget/period";
import { type FinancialYear, rangeQuery } from "@/lib/reports/fy";
import type { DataQuality } from "@/lib/reports/query";

/** "2026/27" — how a person says FY2027 out loud. */
export function fyShort(fy: FinancialYear): string {
  return `${fy.year - 1}/${String(fy.year).slice(2)}`;
}

/**
 * The financial-year selector: one link per selectable year.
 *
 * `basePath` keeps the reader on the screen they are already on, so switching
 * year on the monthly breakdown does not bounce them back to the index.
 */
export function FyLinks({
  years,
  current,
  book,
  basePath,
}: {
  years: FinancialYear[];
  current: FinancialYear;
  book: Book;
  basePath: string;
}) {
  return (
    <div className="seg" role="group" aria-label="Financial year">
      {years.map((year) => (
        <Link
          key={year.year}
          href={withBook(`${basePath}?fy=${year.year}`, book)}
          aria-current={year.year === current.year ? "true" : undefined}
        >
          {fyShort(year)}
        </Link>
      ))}
    </div>
  );
}

/** The FY chip: which year, its full dates, and how far into it the data runs. */
export function FyChip({ fy, rangeEnd }: { fy: FinancialYear; rangeEnd: Date }) {
  const partial = rangeEnd.getTime() < fy.end.getTime();
  return (
    <span style={{ alignSelf: "flex-start" }}>
      <CalendarChip kind="fy" label={`FY ${fyShort(fy)}`}>
        {fy.range}
        {partial ? ` · to date ${nzDate(rangeEnd)}` : ""}
      </CalendarChip>
    </span>
  );
}

/**
 * How complete the figures on this screen are.
 *
 * Not decoration, and not optional on the child screens. Every figure in this
 * section filters on a category's kind, so a transaction with no category is
 * absent from income, absent from expenses, absent from the breakdown and
 * absent from the monthly table — and every total still balances. This is the
 * characteristic failure of the app, and an FY figure is the one eventually
 * read out to an accountant.
 *
 * The link carries the range on screen rather than the pay period, so the list
 * it opens is exactly the rows this count is about.
 */
export function QualityAlerts({
  quality,
  book,
  fy,
  rangeEnd,
  nameBook = false,
}: {
  quality: DataQuality;
  book: Book;
  fy: FinancialYear;
  rangeEnd: Date;
  /** Say which book in the title: on the IR3 pack both books' alerts stack. */
  nameBook?: boolean;
}) {
  const { uncategorisedCount: uncategorised, unassignedAccountCount: unmapped } =
    quality;
  const which = nameBook ? (book === "BUSINESS" ? "business " : "personal ") : "";

  return (
    <>
      {uncategorised > 0 && (
        <Alert
          title={`${uncategorised} ${which}transaction${uncategorised === 1 ? " needs" : "s need"} a category`}
          affects={`Understates: money in and money out for FY ${fyShort(fy)}`}
          actions={
            <Link
              className="btn sm"
              href={withBook(`/transactions?uncategorised=1&${rangeQuery(fy, rangeEnd)}`, book)}
            >
              Categorise them
            </Link>
          }
        >
          {uncategorised === 1 ? "It's" : "They're"} missing from every figure on
          this screen.
        </Alert>
      )}

      {unmapped > 0 && (
        <Alert
          title={`${unmapped} account${unmapped === 1 ? " isn't" : "s aren't"} assigned to a book`}
          affects="Missing: everything in it, from every report"
        >
          Run <code className="mono">npm run accounts:map</code>.
        </Alert>
      )}
    </>
  );
}

/**
 * Links between the four reports screens.
 *
 * They carry the selected year and book, because a reader who has chosen
 * FY2026 and then opens the category breakdown has not asked to go back to
 * this year — and an unlabelled jump between two different date ranges is the
 * exact confusion §2 of the spec exists to prevent.
 */
export function ReportLinks({
  book,
  fy,
  active,
}: {
  book: Book;
  fy: FinancialYear;
  active: "index" | "categories" | "months" | "ir3";
}) {
  const links = [
    { key: "index", href: "/reports", label: "Overview" },
    { key: "categories", href: "/reports/categories", label: "By category" },
    { key: "months", href: "/reports/months", label: "Month by month" },
    { key: "ir3", href: "/reports/ir3", label: "IR3 pack" },
  ] as const;

  return (
    <nav className="seg" aria-label="Reports" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
      {links.map((link) => (
        <Link
          key={link.key}
          href={withBook(`${link.href}?fy=${fy.year}`, book)}
          aria-current={link.key === active ? "true" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

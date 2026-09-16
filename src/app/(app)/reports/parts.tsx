// The chrome every reports screen shares: the year selector, the completeness
// warnings, and the link that carries the current range onto another screen.
//
// A file of its own rather than three copies, because §5 of the 3c spec makes
// the warnings a requirement on *every* reports screen, not just the index —
// and a requirement repeated in three places is a requirement that will end up
// worded three ways and wired to three different date ranges. The count and
// the list behind it have to describe the same window, or a cleared queue
// still shows six.
//
// Server components. Everything here is links, so the section keeps working
// with JavaScript disabled.

import Link from "next/link";
import type { Book } from "@/generated/prisma/client";
import { Alert } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { type FinancialYear, rangeQuery } from "@/lib/reports/fy";
import type { DataQuality } from "@/lib/reports/query";

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
    <div className="mb-head-actions">
      {years.map((year) => {
        const isActive = year.year === current.year;
        return (
          <Link
            key={year.year}
            href={withBook(`${basePath}?fy=${year.year}`, book)}
            aria-current={isActive ? "page" : undefined}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--border-default)",
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-medium)",
              textDecoration: "none",
              background: isActive ? "var(--surface-card-raised)" : "transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {year.label}
          </Link>
        );
      })}
    </div>
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
}: {
  quality: DataQuality;
  book: Book;
  fy: FinancialYear;
  rangeEnd: Date;
}) {
  const { uncategorisedCount: uncategorised, unassignedAccountCount: unmapped } =
    quality;

  return (
    <>
      {uncategorised > 0 && (
        <Alert level="warning">
          {uncategorised} transaction{uncategorised === 1 ? "" : "s"} in this
          range {uncategorised === 1 ? "has" : "have"} no category, so{" "}
          {uncategorised === 1 ? "it is" : "they are"} missing from every figure
          on this screen.{" "}
          <Link
            href={withBook(
              `/transactions?uncategorised=1&${rangeQuery(fy, rangeEnd)}`,
              book,
            )}
          >
            Categorise them
          </Link>
          .
        </Alert>
      )}

      {unmapped > 0 && (
        <Alert level="warning">
          {unmapped} account{unmapped === 1 ? " is" : "s are"} not assigned to a
          set of books, so nothing in {unmapped === 1 ? "it" : "them"} appears in
          any report. Run <code>npm run accounts:map</code>.
        </Alert>
      )}
    </>
  );
}

/**
 * Links between the three reports screens.
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
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        fontFamily: "var(--font-sans)",
      }}
    >
      {links.map((link) => {
        const isActive = link.key === active;
        return (
          <Link
            key={link.key}
            href={withBook(`${link.href}?fy=${fy.year}`, book)}
            aria-current={isActive ? "page" : undefined}
            style={{
              padding: "8px 14px",
              minHeight: 36,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-default)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              textDecoration: "none",
              background: isActive ? "var(--surface-card-raised)" : "transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}

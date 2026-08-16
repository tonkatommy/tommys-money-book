// The app chrome: sidebar, header, bottom tab bar.
//
// A component each page renders rather than a `layout.tsx`, for one concrete
// reason: layouts don't receive `searchParams` in the App Router, and the
// selected book lives in the query string so the toggle can be two links
// instead of client state. A layout would have to read the book from a cookie
// or a client hook, and both are worse than passing it down explicitly.
//
// One layout for every width. The prototype had a Desktop/Phone switch that
// swapped a React context; this has media queries (globals.css) and the
// switch is gone — the sidebar and the tab bar are the same nav rendered
// twice, each hidden at the other's breakpoint.

import type { ReactNode } from "react";
import type { Book } from "@/generated/prisma/client";
import { BottomNav, BookToggle, SideNav } from "@/components/ui/nav";
import { Badge, ButtonLink } from "@/components/ui/primitives";
import { logout } from "@/app/login/actions";
import type { PayPeriod } from "@/lib/budget/period";

export function AppShell({
  active,
  book,
  period,
  basePath,
  preserveQuery,
  splitFortnightly = false,
  lockBook = false,
  children,
}: {
  /** Which nav item is current — see NAV in components/ui/nav.tsx. */
  active: string;
  book: Book;
  period: PayPeriod;
  /** Path the book toggle links back to, so switching stays on this screen. */
  basePath: string;
  /**
   * Query string the book toggle carries across the switch.
   *
   * The screen decides, because only it knows which of its parameters are ids
   * belonging to one book. See `bookAgnosticQuery` in lib/transactions/query.ts.
   */
  preserveQuery?: string;
  splitFortnightly?: boolean;
  /**
   * This screen's book is a property of the record it shows, not a choice.
   *
   * A category drilldown is reached by id, and that id already determines the
   * book — so the toggle has nothing to toggle. Rendering it anyway leaves a
   * control that looks live and does nothing when pressed, which is worse than
   * not offering it.
   */
  lockBook?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-shell">
      <div className="mb-sidebar">
        <SideNav active={active} book={book} />
      </div>

      <div className="mb-main">
        <header className="mb-header">
          <div className="mb-header-period">
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
              }}
            >
              Pay period
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginTop: 3,
                flexWrap: "wrap",
              }}
            >
              <span
                className="mb-num"
                style={{
                  fontSize: "var(--text-md)",
                  fontWeight: "var(--weight-semibold)",
                }}
              >
                {period.label}
              </span>
              <span
                style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}
              >
                {period.daysLeft === 0
                  ? "payday tomorrow"
                  : `${period.daysLeft} days to payday`}
                {splitFortnightly ? " · fortnightly" : ""}
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {lockBook ? (
              <Badge tone="neutral">
                {book === "BUSINESS" ? "Business" : "Personal"} book
              </Badge>
            ) : (
              <BookToggle
                value={book}
                basePath={basePath}
                preserve={preserveQuery}
              />
            )}

            {/* Wide only: the bottom tab bar already carries Sync below 768px,
                so this would be a second route to the same screen.
                A link, not an action — a full Akahu sync takes long enough that
                holding a request open for it is a worse trade than a click. */}
            <span className="mb-wide-flex">
              <ButtonLink href="/sync" variant="primary" size="sm">
                Sync
              </ButtonLink>
            </span>

            {/* Every width. Sign out has no equivalent in the tab bar, so
                hiding it on a phone would leave no way to end a session on the
                device most likely to be lost. */}
            <form action={logout}>
              <button
                className="mb-btn"
                type="submit"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-xs)",
                  fontWeight: "var(--weight-semibold)",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main className="mb-body">{children}</main>
      </div>

      <BottomNav active={active} book={book} />
    </div>
  );
}

// The app chrome: sidebar, header, bottom tab bar.
//
// A component each page renders rather than a `layout.tsx`, for one concrete
// reason: layouts don't receive `searchParams` in the App Router, and the
// selected book lives in the query string so the toggle can be two links
// instead of client state. A layout would have to read the book from a cookie
// or a client hook, and both are worse than passing it down explicitly.
//
// One layout for every width: the sidebar and the tab bar are the same nav
// rendered twice, each hidden by design.css at the other's breakpoint.
// Markup and classes follow the Money Book canvas (Budget.dc.html).

import type { ReactNode } from "react";
import type { Book } from "@/generated/prisma/client";
import { BottomNav, BookToggle, SideNav } from "@/components/ui/nav";
import { logout } from "@/app/login/actions";
import type { PayPeriod } from "@/lib/budget/period";
import { getShellStatus } from "@/lib/shell";

const time = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export async function AppShell({
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
   * This screen's book is fixed, not a choice.
   *
   * `true`: the book is a property of the record shown (a category reached by
   * id) or of the feature (goals are personal only), so the toggle would look
   * live and do nothing. `"both"`: the screen spans both books (the IR3
   * pack). Either way a dashed, locked label replaces the toggle.
   */
  lockBook?: boolean | "both";
  children: ReactNode;
}) {
  const status = await getShellStatus(book, period);

  return (
    <div className="app">
      <SideNav active={active} book={book} uncategorised={status.uncategorised} />

      <div className="main">
        <header className="top">
          <span className="cal pp">
            <span className="i i-cycle sm" aria-hidden="true" />
            {period.label} ·{" "}
            <b>
              {period.daysLeft === 0
                ? "payday tomorrow"
                : `${period.daysLeft} days to payday`}
            </b>
            {splitFortnightly ? " · half view" : ""}
          </span>
          <span className="grow" />

          <SyncIndicator status={status} />

          {/* Every width. The tab bar has no sign out, so hiding it on a phone
              would leave no way to end a session on the device most likely
              to be lost. */}
          <form action={logout}>
            <button type="submit" className="btn sm ghost signout">
              <span className="i i-out-door sm" aria-hidden="true" />
              <span className="dt-only">Sign out</span>
              <span className="ph-only vh">Sign out</span>
            </button>
          </form>

          {lockBook ? (
            <span className="book-fixed">
              {lockBook === "both" ? (
                <>
                  <span className="bk p" aria-hidden="true" />
                  <span className="bk b" aria-hidden="true" />
                  Both books
                </>
              ) : (
                <>
                  <span
                    className={`bk ${book === "BUSINESS" ? "b" : "p"}`}
                    aria-hidden="true"
                  />
                  {book === "BUSINESS" ? "Business" : "Personal"} book
                </>
              )}
              <span className="i i-lock sm lk" aria-hidden="true" />
            </span>
          ) : (
            <BookToggle value={book} basePath={basePath} preserve={preserveQuery} />
          )}
        </header>

        <main className="content">{children}</main>

        <BottomNav active={active} book={book} uncategorised={status.uncategorised} />
      </div>
    </div>
  );
}

/**
 * Green dot, amber ring or red diamond: shape differs as well as colour, so
 * a stopped feed is visible without relying on hue. A link, not an action —
 * a full Akahu sync takes long enough that holding a request open for it is
 * a worse trade than a click through to the status page.
 */
function SyncIndicator({
  status,
}: {
  status: Awaited<ReturnType<typeof getShellStatus>>;
}) {
  if (status.health === "failing") {
    return (
      <a className="syncind bad" href="/sync">
        <span className="dot bad" aria-hidden="true" />
        Sync failing
      </a>
    );
  }
  if (status.health === "overdue") {
    return (
      <a className="syncind warn" href="/sync">
        <span className="dot warn" aria-hidden="true" />
        Sync overdue
      </a>
    );
  }
  return (
    <a className="syncind" href="/sync">
      <span className="dot" aria-hidden="true" />
      <span className="dt-only">Synced&nbsp;</span>
      {status.lastSuccess ? time.format(status.lastSuccess) : ""}
    </a>
  );
}

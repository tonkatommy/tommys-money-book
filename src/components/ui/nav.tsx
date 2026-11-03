// Navigation. All links, no client state.
//
// The sidebar, the tab bar and the book toggle are real URLs: the book
// toggle is two links that differ only by a query parameter. That keeps every
// screen a server component, makes each view bookmarkable, and means the back
// button does what it looks like it does.
//
// Markup follows the Money Book canvas (Budget.dc.html): the classes are
// design.css's, so a change made on the canvas lands here as a class, not a
// re-derived inline style.

import Link from "next/link";
import type { Book } from "@/generated/prisma/client";

type NavLink = {
  key: string;
  href: string;
  label: string;
  /** design.css icon class, without the `i-` prefix. */
  icon?: string;
  /** Indented under the item above it. */
  sub?: boolean;
  /** Carries the uncategorised count. */
  counted?: boolean;
};

type NavGroup = { heading?: string; items: NavLink[] };

// Grouped as the canvas has it: the daily screens first, then the planning
// pair you visit once a period, then the system screens. Past periods,
// savings goals and the IR3 pack sit as sub-items under the screen they
// belong to, so the sidebar shows where they live rather than seven
// unrelated destinations.
export const NAV: NavGroup[] = [
  {
    items: [
      { key: "budget", href: "/budget", label: "Budget", icon: "home" },
      { key: "history", href: "/budget/history", label: "How past periods went", sub: true },
      // Personal only, so it always links without a book.
      { key: "goals", href: "/goals", label: "Savings goals", sub: true },
      {
        key: "transactions",
        href: "/transactions",
        label: "Transactions",
        icon: "list",
        counted: true,
      },
      // Its own item rather than a link inside Transactions: an unconfirmed
      // transfer is money the budget is counting as income or spending, and
      // a queue you can't see is a queue that doesn't get cleared.
      { key: "transfers", href: "/transfers", label: "Transfers", icon: "swap" },
      { key: "reports", href: "/reports", label: "Reports", icon: "chart" },
      { key: "ir3", href: "/reports/ir3", label: "IR3 tax pack", sub: true },
    ],
  },
  {
    heading: "Planning",
    items: [
      { key: "setup", href: "/budget/setup", label: "Set budget", icon: "sliders" },
      { key: "review", href: "/budget/review", label: "Month end", icon: "calcheck" },
    ],
  },
  {
    heading: "System",
    items: [
      { key: "sync", href: "/sync", label: "Sync status", icon: "sync" },
      { key: "guide", href: "/guide", label: "How to use this app", icon: "help" },
    ],
  },
];

// Screens with no item of their own light up the nearest one.
const PARENT: Record<string, string> = {
  goals: "budget",
  history: "budget",
  ir3: "reports",
};

const LOCKED_TO_PERSONAL = new Set(["goals"]);

function href(item: NavLink, book: Book) {
  return LOCKED_TO_PERSONAL.has(item.key) ? item.href : withBook(item.href, book);
}

/** Left sidebar, 768px and up. design.css hides it below that. */
export function SideNav({
  active,
  book,
  uncategorised,
}: {
  active: string;
  book: Book;
  uncategorised: number;
}) {
  return (
    <aside className="side">
      <Link className="logo" href={withBook("/budget", book)}>
        <span className="mk" aria-hidden="true" />
        Money Book
      </Link>
      <nav aria-label="Main">
        {NAV.map((group, g) => (
          <div key={g} style={{ display: "contents" }}>
            {group.heading && <span className="lbl grp">{group.heading}</span>}
            {group.items.map((item) => (
              <Link
                key={item.key}
                className={item.sub ? "nv sub" : "nv"}
                href={href(item, book)}
                aria-current={item.key === active ? "page" : undefined}
              >
                {item.icon && <span className={`i i-${item.icon}`} aria-hidden="true" />}
                {item.label}
                {item.counted && uncategorised > 0 && (
                  <span className="cnt" aria-label={`${uncategorised} need a category`}>
                    {uncategorised}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

const TABS = [
  { key: "budget", href: "/budget", label: "Budget", icon: "home" },
  { key: "transactions", href: "/transactions", label: "Spending", icon: "list" },
  { key: "transfers", href: "/transfers", label: "Transfers", icon: "swap" },
  { key: "reports", href: "/reports", label: "Reports", icon: "chart" },
];

/**
 * Bottom tab bar, below 768px. Four destinations and a More menu.
 *
 * More is a native <details>, not a sheet with script behind it: it opens on
 * tap with JavaScript off, and the links inside are ordinary links. Seven
 * equal tabs (the old bar) made every label too short to read.
 */
export function BottomNav({
  active,
  book,
  uncategorised,
}: {
  active: string;
  book: Book;
  uncategorised: number;
}) {
  const current = PARENT[active] ?? active;
  const moreItems = NAV.flatMap((g) => g.items).filter(
    (item) => !TABS.some((t) => t.key === item.key),
  );
  const moreActive = moreItems.some((item) => item.key === active);

  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={withBook(tab.href, book)}
          aria-current={tab.key === current && !moreActive ? "page" : undefined}
        >
          <span className={`i i-${tab.icon}`} aria-hidden="true" />
          {tab.label}
          {tab.key === "transactions" && uncategorised > 0 && (
            <span className="cnt" aria-label={`${uncategorised} need a category`}>
              {uncategorised}
            </span>
          )}
        </Link>
      ))}
      <details className="more">
        <summary aria-current={moreActive ? "page" : undefined}>
          <span className="i i-more" aria-hidden="true" />
          More
        </summary>
        <div className="more-menu sheet">
          {moreItems.map((item) => (
            <Link
              key={item.key}
              href={href(item, book)}
              aria-current={item.key === active ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}

/**
 * Personal / Business segmented control, as two links.
 *
 * `preserve` is the query string to carry across the switch — the caller
 * decides what still means something in the other book, because only it knows
 * which of its parameters are ids scoped to one set of books. Omitted, the
 * switch lands on the screen's default view.
 *
 * The glyph shape carries the book (circle Personal, square Business), so the
 * toggle reads without colour.
 */
export function BookToggle({
  value,
  basePath,
  preserve,
}: {
  value: Book;
  basePath: string;
  preserve?: string;
}) {
  const href = preserve ? `${basePath}?${preserve}` : basePath;

  const options: { key: Book; label: string; glyph: string }[] = [
    { key: "PERSONAL", label: "Personal", glyph: "p" },
    { key: "BUSINESS", label: "Business", glyph: "b" },
  ];

  return (
    <div className="seg bookseg" role="group" aria-label="Book">
      {options.map((option) => (
        <Link
          key={option.key}
          href={withBook(href, option.key)}
          aria-current={value === option.key ? "true" : undefined}
        >
          <span className={`bk ${option.glyph}`} aria-hidden="true" />
          {option.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Carry the current book across a link.
 *
 * PERSONAL is the default and is left out of the URL, so the common case
 * produces clean links and `/budget` always means the personal book.
 */
export function withBook(href: string, book: Book): string {
  if (book === "PERSONAL") return href;
  const [path, existing] = href.split("?");
  const params = new URLSearchParams(existing);
  params.set("book", book);
  return `${path}?${params.toString()}`;
}

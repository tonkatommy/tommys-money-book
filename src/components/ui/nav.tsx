// Navigation. All links, no client state.
//
// The prototype drove navigation and the book switch through React state.
// Here they are real URLs: the sidebar and tab bar are <Link>s, and the book
// toggle is two links that differ only by a query parameter. That keeps every
// budget screen a server component, makes each view bookmarkable, and means
// the back button does what it looks like it does — the same reasoning the
// Phase 3a spec applied to the transaction filters.

import Link from "next/link";
import type { Book } from "@/generated/prisma/client";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  /** Shorter label for the bottom tab bar, where five items share the width. */
  short: string;
};

export const NAV: NavItem[] = [
  { key: "budget", href: "/budget", label: "Budget", short: "Budget" },
  {
    key: "transactions",
    href: "/transactions",
    label: "Transactions",
    short: "Txns",
  },
  { key: "setup", href: "/budget/setup", label: "Set budget", short: "Set up" },
  { key: "review", href: "/budget/review", label: "Month end", short: "Close" },
  { key: "sync", href: "/sync", label: "Sync status", short: "Sync" },
];

/** Left sidebar. Hidden below 768px, where BottomNav takes over. */
export function SideNav({ active, book }: { active: string; book: Book }) {
  return (
    <nav
      style={{
        width: 220,
        height: "100%",
        background: "var(--surface-card)",
        borderRight: "1px solid var(--border-subtle)",
        padding: "var(--space-6) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-md)",
          color: "var(--text-primary)",
          padding: "0 var(--space-2)",
          marginBottom: "var(--space-6)",
        }}
      >
        Money Book
      </div>
      {NAV.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={withBook(item.href, book)}
            aria-current={isActive ? "page" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              textDecoration: "none",
              color: isActive ? "var(--text-on-accent)" : "var(--text-secondary)",
              background: isActive ? "var(--accent-gradient)" : "transparent",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Fixed bottom tab bar, shown below 768px only. 44px targets. */
export function BottomNav({ active, book }: { active: string; book: Book }) {
  return (
    <nav
      className="ds-bottom-nav"
      style={{ gridTemplateColumns: `repeat(${NAV.length},1fr)` }}
    >
      {NAV.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={withBook(item.href, book)}
            aria-current={isActive ? "page" : undefined}
            style={{
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 6px",
              borderRadius: "var(--radius-md)",
              textDecoration: "none",
              textAlign: "center",
              background: isActive ? "var(--accent-gradient)" : "transparent",
              color: isActive ? "var(--text-on-accent)" : "var(--text-muted)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-medium)",
            }}
          >
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}

/** Personal / Business segmented control, as two links. */
export function BookToggle({
  value,
  basePath,
}: {
  value: Book;
  basePath: string;
}) {
  const options: { key: Book; label: string; dot: string }[] = [
    { key: "PERSONAL", label: "Personal", dot: "var(--book-personal)" },
    { key: "BUSINESS", label: "Business", dot: "var(--book-business)" },
  ];

  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--surface-inset)",
        borderRadius: "var(--radius-full)",
        padding: 3,
        border: "1px solid var(--border-default)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {options.map((option) => {
        const isActive = value === option.key;
        return (
          <Link
            key={option.key}
            href={withBook(basePath, option.key)}
            aria-current={isActive ? "true" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              textDecoration: "none",
              background: isActive ? "var(--surface-card-raised)" : "transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: option.dot,
              }}
            />
            {option.label}
          </Link>
        );
      })}
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

// Core primitives, rendered as the Money Book canvas's components.
//
// Each one emits design.css classes (`.badge`, `.btn`, `.card`, `.banner`)
// rather than styling itself inline, so it stays a one-to-one match with the
// canvas's Components artboard: a visual change made there lands as a CSS
// diff, not a re-derived style object.
//
// All server components. Nothing here has state or an event handler, which is
// what lets every screen render without shipping any JavaScript.

import type { CSSProperties, ReactNode } from "react";
import type { Book } from "@/generated/prisma/client";

export type Tone = "ok" | "warning" | "error" | "neutral";

const badgeClass: Record<Tone, string> = {
  ok: "badge b-ok",
  warning: "badge b-warn",
  error: "badge b-bad",
  neutral: "badge",
};

/** Small status label — "balanced", "needs mapping", "drift $12.40". */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={badgeClass[tone]}>{children}</span>;
}

const buttonVariants = {
  primary: "btn primary",
  secondary: "btn",
  quiet: "btn quiet",
  ghost: "btn ghost",
  danger: "btn danger",
} as const;

const buttonSizes = { sm: " sm", md: "", lg: "" } as const;

type ButtonProps = {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  children: ReactNode;
  type?: "button" | "submit";
  name?: string;
  value?: string;
  disabled?: boolean;
  block?: boolean;
  style?: CSSProperties;
};

/**
 * One filled button per screen, for the action the screen exists for.
 * Hover is CSS-only, so a button inside a server-rendered form needs no
 * client component.
 */
export function Button({
  variant = "primary",
  size = "md",
  children,
  type = "button",
  name,
  value,
  disabled = false,
  block = false,
  style,
}: ButtonProps) {
  return (
    <button
      className={`${buttonVariants[variant]}${buttonSizes[size]}${block ? " block" : ""}`}
      type={type}
      name={name}
      value={value}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}

/** A Button that navigates. Same skin, anchor semantics. */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  children,
}: {
  href: string;
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  children: ReactNode;
}) {
  return (
    <a className={`${buttonVariants[variant]}${buttonSizes[size]}`} href={href}>
      {children}
    </a>
  );
}

/** design.css icon, decorative. `name` is the part after `i-`. */
export function Icon({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return <span className={`i i-${name}${size ? ` ${size}` : ""}`} aria-hidden="true" />;
}

/** The base container for every panel in the app. */
export function Card({
  title,
  action,
  children,
  padded = true,
  label,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  /** Accessible name when the card has no visible title. */
  label?: string;
}) {
  return (
    <section
      className={padded ? "card pad-l" : "card"}
      style={padded ? undefined : { padding: 0, overflow: "hidden" }}
      aria-label={label}
    >
      {(title || action) && (
        <div
          className="card-h"
          style={padded ? undefined : { padding: "16px 20px 0" }}
        >
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Dot + label, for at-a-glance health. Shape differs per tone, not just hue. */
export function StatusDot({ tone = "neutral", label }: { tone?: Tone; label?: ReactNode }) {
  const dot =
    tone === "error" ? "dot bad" : tone === "warning" ? "dot warn" : "dot";
  return (
    <span className="row" style={{ gap: 8 }}>
      <span
        className={dot}
        aria-hidden="true"
        style={tone === "neutral" ? { background: "var(--ink-3)" } : undefined}
      />
      {label && <span className="t-s ink2">{label}</span>}
    </span>
  );
}

/**
 * Warning banner. Sits ABOVE the figures it affects, most serious first.
 *
 * `title` is what is wrong, `children` the detail, and `affects` names the
 * figures it bends ("Understates: spending, pace, safe to spend"), because
 * a warning that doesn't say which number to distrust gets read as noise.
 */
export function Alert({
  level = "warning",
  title,
  affects,
  actions,
  icon,
  children,
}: {
  level?: "warning" | "error" | "info";
  title?: ReactNode;
  affects?: ReactNode;
  actions?: ReactNode;
  icon?: string;
  children?: ReactNode;
}) {
  const cls = level === "error" ? "banner bad" : level === "info" ? "banner info" : "banner";
  const glyph = icon ?? (level === "error" ? "alert" : level === "info" ? "info" : "warn");
  return (
    <div className={cls} role={level === "error" ? "alert" : undefined}>
      <Icon name={glyph} />
      <div>
        {title && <p className="bt">{title}</p>}
        {children &&
          (title ? (
            <div className="bb">{children}</div>
          ) : (
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>{children}</div>
          ))}
        {affects && <p className="aff">{affects}</p>}
        {actions && <div className="acts">{actions}</div>}
      </div>
    </div>
  );
}

/** Category name with its book glyph: circle Personal, square Business. */
export function CategoryTag({ name, book }: { name: string; book?: Book | null }) {
  return (
    <span className="row" style={{ gap: 6, minWidth: 0, display: "inline-flex" }}>
      {book && (
        <span className={`bk ${book === "BUSINESS" ? "b" : "p"}`} aria-hidden="true" />
      )}
      <span className="mb-truncate">{name}</span>
    </span>
  );
}

/** Nothing-here state: says why it's empty and what happens next. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  /** design.css icon name. */
  icon?: string;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  /** Kept for callers; the design has one empty-state size. */
  compactPad?: boolean;
}) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} />}
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

/** Loading placeholder. Size it to the real content so the page doesn't jump. */
export function Skeleton({
  width = "100%",
  height = 12,
  radius = "var(--radius-sm)",
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="ds-skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** Label + control + inline message. Errors render under the control, never as a toast. */
export function FormField({
  label,
  hint,
  error,
  htmlFor,
  required = false,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && <span className="ink3"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="err-t" role="alert">
          <Icon name="alert" size="sm" />
          {error}
        </span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </div>
  );
}

/** "Covers 20/10 – 19/11/2026": the date range every total carries. */
export function Range({ children }: { children: ReactNode }) {
  return <span className="range">{children}</span>;
}

/** Pay-period chip (pill) or financial-year chip (tab): the two calendars. */
export function CalendarChip({
  kind,
  label,
  children,
  small = false,
}: {
  kind: "pp" | "fy" | "mo";
  /** The short key before the range, e.g. "Pay period" or "FY". */
  label?: ReactNode;
  children: ReactNode;
  small?: boolean;
}) {
  const icon = kind === "pp" ? "cycle" : kind === "fy" ? "fy" : "cal";
  return (
    <span className={`cal ${kind}${small ? " sm" : ""}`}>
      <Icon name={icon} size="sm" />
      {label && <span className="k">{label}</span>}
      {children}
    </span>
  );
}

/** Data that isn't there. Never a $0.00 standing in for "unknown". */
export function Missing({ children = "not entered" }: { children?: ReactNode }) {
  return <span className="na">{children}</span>;
}

/**
 * Who decided a transaction's category.
 *
 * Rules are dashed because they can be re-run. A hand decision is solid ink,
 * like a stamp, because nothing overwrites it (`categorySource = MANUAL` is
 * what the matcher and the daily sync both skip).
 */
export function Provenance({
  source,
  hasCategory = true,
  short = false,
}: {
  source: "RULE" | "MANUAL" | "TRANSFER" | null;
  /** A row with no category has nobody to credit, whatever the source says. */
  hasCategory?: boolean;
  short?: boolean;
}) {
  if (!hasCategory || source === null) {
    return (
      <span className="prov none">
        <Icon name="warn" />
        Nobody yet
      </span>
    );
  }
  if (source === "MANUAL") {
    return (
      <span className="prov hand">
        <Icon name="pen" />
        {short ? "By hand" : "By hand · permanent"}
      </span>
    );
  }
  if (source === "TRANSFER") {
    return (
      <span className="prov xfer">
        <Icon name="swap" />
        {short ? "Transfer" : "Confirmed transfer"}
      </span>
    );
  }
  return (
    <span className="prov rule">
      <Icon name="rule" />
      Rule
    </span>
  );
}

// The design system's core primitives, ported from the Claude Design project
// be28709a-d521-4a24-8404-a9233306867c.
//
// They style themselves with inline styles over CSS custom properties, exactly
// as the design system does. That is deliberate rather than lazy: it keeps
// each component a one-to-one match with its source in the design project, so
// a visual change made there can be diffed against the code here instead of
// being re-derived from a screenshot. The tokens themselves live in
// globals.css.
//
// All server components. Nothing here has state or an event handler, which is
// what lets the budget screens render without shipping any JavaScript.

import type { CSSProperties, ReactNode } from "react";
import type { Book } from "@/generated/prisma/client";

export type Tone = "ok" | "warning" | "error" | "neutral";

const toneVars = (tone: Tone) => ({
  color: `var(--status-${tone})`,
  background: `var(--status-${tone}-bg)`,
  border: `1px solid var(--status-${tone}-border)`,
});

/** Small pill for status — "balanced", "needs mapping", "drift $12.40". */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: "var(--radius-full)",
        padding: "3px 10px",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
        ...toneVars(tone),
      }}
    >
      {children}
    </span>
  );
}

const buttonSizes = {
  sm: { padding: "6px 12px", fontSize: "var(--text-xs)" },
  md: { padding: "9px 16px", fontSize: "var(--text-sm)" },
  lg: { padding: "12px 22px", fontSize: "var(--text-base)" },
} as const;

const buttonVariants = {
  primary: {
    background: "var(--accent-gradient)",
    color: "var(--text-on-accent)",
    boxShadow: "var(--shadow-glow-accent)",
  },
  secondary: {
    background: "var(--surface-card-raised)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-default)",
  },
  ghost: { background: "transparent", color: "var(--text-secondary)" },
  danger: {
    background: "var(--status-error-bg)",
    color: "var(--status-error)",
    border: "1px solid var(--status-error-border)",
  },
} as const;

type ButtonProps = {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  children: ReactNode;
  type?: "button" | "submit";
  name?: string;
  value?: string;
  disabled?: boolean;
  style?: CSSProperties;
};

/**
 * The amber gradient is the brand's one loud element — used sparingly.
 *
 * Hover and press states are CSS-only (see the `.mb-btn` rules in
 * globals.css) rather than the design system's inline mouse handlers, because
 * handlers would make every button a client component and this is mostly used
 * inside forms on server-rendered pages.
 */
export function Button({
  variant = "primary",
  size = "md",
  children,
  type = "button",
  name,
  value,
  disabled = false,
  style,
}: ButtonProps) {
  return (
    <button
      className="mb-btn"
      type={type}
      name={name}
      value={value}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 32,
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-semibold)",
        border: "1px solid transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...buttonSizes[size],
        ...buttonVariants[variant],
        ...style,
      }}
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
    <a
      className="mb-btn"
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 32,
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-semibold)",
        border: "1px solid transparent",
        textDecoration: "none",
        ...buttonSizes[size],
        ...buttonVariants[variant],
      }}
    >
      {children}
    </a>
  );
}

/** Elevated dark card — the base container for every panel in the app. */
export function Card({
  title,
  action,
  children,
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-card)",
        padding: padded ? "var(--space-6)" : 0,
        fontFamily: "var(--font-sans)",
      }}
    >
      {(title || action) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            flexWrap: "wrap",
            padding: padded ? 0 : "var(--space-6) var(--space-6) 0",
            marginBottom: "var(--space-4)",
          }}
        >
          {title && (
            <h2
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-secondary)",
              }}
            >
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Dot + label, for at-a-glance system health. */
export function StatusDot({ tone = "neutral", label }: { tone?: Tone; label?: ReactNode }) {
  const colour = `var(--status-${tone})`;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-sans)",
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          flexShrink: 0,
          borderRadius: "var(--radius-full)",
          background: colour,
          boxShadow: `0 0 8px ${colour}`,
        }}
      />
      {label && (
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          {label}
        </span>
      )}
    </span>
  );
}

/** Inline banner for sync errors and review-queue warnings. */
export function Alert({
  level = "warning",
  children,
}: {
  level?: "warning" | "error";
  children: ReactNode;
}) {
  const tone = level === "error" ? "error" : "warning";
  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        fontSize: "var(--text-sm)",
        fontFamily: "var(--font-sans)",
        ...toneVars(tone),
      }}
    >
      {children}
    </div>
  );
}

/** Category tag. The book shows as a coloured dot, never as a word. */
export function CategoryTag({ name, book }: { name: string; book?: Book | null }) {
  const dot =
    book === "BUSINESS"
      ? "var(--book-business)"
      : book === "PERSONAL"
        ? "var(--book-personal)"
        : "var(--text-muted)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: "var(--radius-full)",
        background: "var(--surface-card-raised)",
        border: "1px solid var(--border-default)",
        fontSize: "var(--text-xs)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        maxWidth: "100%",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          flexShrink: 0,
          borderRadius: "var(--radius-full)",
          background: dot,
        }}
      />
      <span className="mb-truncate">{name}</span>
    </span>
  );
}

/** Nothing-here state: one mark, one line, one action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compactPad = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compactPad?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "var(--space-3)",
        padding: compactPad
          ? "var(--space-6) var(--space-4)"
          : "var(--space-10) var(--space-6)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {icon && (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-full)",
            background: "var(--surface-inset)",
            border: "1px solid var(--border-default)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-lg)",
          }}
        >
          {icon}
        </div>
      )}
      <div
        style={{
          fontSize: "var(--text-md)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text-primary)",
        }}
      >
        {title}
      </div>
      {body && (
        <p
          style={{
            margin: 0,
            maxWidth: 400,
            fontSize: "var(--text-sm)",
            color: "var(--text-tertiary)",
            lineHeight: "var(--leading-normal)",
          }}
        >
          {body}
        </p>
      )}
      {action && <div style={{ marginTop: "var(--space-2)" }}>{action}</div>}
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        fontFamily: "var(--font-sans)",
      }}
    >
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            fontWeight: "var(--weight-medium)",
          }}
        >
          {label}
          {required && <span style={{ color: "var(--text-muted)" }}> *</span>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <div
          role={error ? "alert" : undefined}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            fontSize: "var(--text-xs)",
            lineHeight: 1.5,
            color: error ? "var(--status-error)" : "var(--text-muted)",
          }}
        >
          {error && (
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--status-error)",
                marginTop: 5,
                flexShrink: 0,
              }}
            />
          )}
          <span>{error || hint}</span>
        </div>
      )}
    </div>
  );
}

// Data-display components from the design system: the budget bar and the
// single on-track verdict. Both take integer cents, like everything else that
// touches money in this codebase.

import Link from "next/link";
import type { ReactNode } from "react";
import { formatNZD } from "@/lib/money";

type PaceTone = "accent" | "ok" | "warning" | "error";

const fills: Record<PaceTone, string> = {
  accent: "var(--accent-gradient)",
  ok: "var(--status-ok)",
  warning: "var(--status-warning)",
  error: "var(--status-error)",
};

/**
 * A budget bar with an optional "where you should be today" marker.
 *
 * The marker is the whole point. A bar at 60% means nothing on its own — 60%
 * on day 6 of a month is a problem and 60% on day 27 is not. The marker is
 * how far through the period you are, so the comparison is visual and
 * immediate rather than arithmetic the reader has to do.
 */
export function PaceBar({
  spentCents,
  budgetCents,
  markerPct = null,
  height = 8,
  tone,
}: {
  spentCents: number;
  budgetCents: number;
  markerPct?: number | null;
  height?: number;
  tone?: PaceTone;
}) {
  const pct =
    budgetCents > 0
      ? Math.min(100, Math.max(0, (spentCents / budgetCents) * 100))
      : 0;
  const over = budgetCents > 0 && spentCents > budgetCents;

  // Warning only once spending is meaningfully past the marker, not the
  // instant it crosses — a bar that flickers amber every other day is noise.
  const resolved: PaceTone =
    tone ??
    (over
      ? "error"
      : markerPct != null && pct > markerPct + 4
        ? "warning"
        : "accent");

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          height,
          borderRadius: "var(--radius-full)",
          background: "var(--surface-inset)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: fills[resolved],
            borderRadius: "var(--radius-full)",
          }}
        />
      </div>
      {markerPct != null && (
        <div
          title="Where you should be today"
          style={{
            position: "absolute",
            top: -3,
            left: `calc(${Math.min(100, Math.max(0, markerPct))}% - 1px)`,
            width: 2,
            height: height + 6,
            background: "var(--text-secondary)",
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
      )}
    </div>
  );
}

/**
 * The on-track verdict. `deltaCents` positive means under pace.
 *
 * One sentence, one colour. The overview deliberately has exactly one of
 * these at the top: the screen's job is to answer "am I alright?" before the
 * reader has to look at anything else.
 */
export function Verdict({
  deltaCents,
  size = "md",
  warningAtCents = -6000,
}: {
  deltaCents: number;
  size?: "md" | "lg";
  warningAtCents?: number;
}) {
  const ok = deltaCents >= 0;
  const tone = ok ? "ok" : deltaCents > warningAtCents ? "warning" : "error";
  const text = ok
    ? `${formatNZD(deltaCents)} under pace`
    : `${formatNZD(Math.abs(deltaCents))} over pace`;

  const shell = {
    display: "inline-flex",
    alignItems: "center",
    gap: size === "lg" ? 8 : 6,
    color: `var(--status-${tone})`,
    background: `var(--status-${tone}-bg)`,
    border: `1px solid var(--status-${tone}-border)`,
    borderRadius: "var(--radius-full)",
    fontFamily: "var(--font-sans)",
    whiteSpace: "nowrap" as const,
  };

  if (size === "lg") {
    return (
      <span
        style={{
          ...shell,
          padding: "6px 14px",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-semibold)",
        }}
      >
        {ok ? "On track" : "Off track"} ·{" "}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: "var(--weight-medium)",
          }}
        >
          {text}
        </span>
      </span>
    );
  }

  return (
    <span
      style={{
        ...shell,
        padding: "3px 10px",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
      }}
    >
      {text}
    </span>
  );
}

/** Small key/value line used inside cards. */
export function KV({
  label,
  value,
  tone,
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        fontSize: "var(--text-sm)",
      }}
    >
      <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          color: tone ?? "var(--text-primary)",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** A labelled figure block — used for the stat strips. */
export function Figure({
  label,
  value,
  tone,
  note,
  noteTone,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  note?: ReactNode;
  noteTone?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        className="mb-num"
        style={{ fontSize: "var(--text-md)", color: tone ?? "var(--text-primary)" }}
      >
        {value}
      </div>
      {note && (
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: noteTone ?? "var(--text-tertiary)",
            marginTop: 2,
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * Daily spend bars across a period.
 *
 * Days after today are drawn faint rather than omitted, so the shape of the
 * bar chart is the shape of the period — you can see how much runway is left
 * without reading an axis.
 */
export function DayBars({
  series,
}: {
  series: { label: string; cents: number; future: boolean }[];
}) {
  const max = Math.max(...series.map((s) => s.cents), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 72 }}>
      {series.map((s, i) => (
        <div
          key={i}
          title={`${s.label}: ${formatNZD(s.cents)}`}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            height: "100%",
          }}
        >
          <div
            style={{
              height: `${(s.cents / max) * 100}%`,
              minHeight: s.cents > 0 ? 3 : 1,
              background: s.cents > 0 ? "var(--money-out)" : "var(--border-subtle)",
              borderRadius: 2,
              opacity: s.future ? 0.25 : 1,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Screen title, optional subtitle, optional actions. */
export function ScreenHead({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-head">
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: "var(--text-xl)",
            fontWeight: "var(--weight-bold)",
            color: "var(--text-primary)",
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          {title}
        </h2>
        {sub && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "var(--text-sm)",
              color: "var(--text-tertiary)",
              maxWidth: 620,
            }}
          >
            {sub}
          </p>
        )}
      </div>
      {right && <div className="mb-head-actions">{right}</div>}
    </div>
  );
}

/**
 * A ranked horizontal bar list — label, amount, share of the total.
 *
 * Sits alongside `DayBars` rather than replacing it, and shares only its
 * max-scaling idea. `DayBars` is vertical, one bar per day of a period, and
 * hardcoded to `--money-out`; this is one bar per row with a label and an
 * amount, and it carries a `tone` because it is used for both sides of the
 * books.
 *
 * Three decisions worth stating, because each of them is a way this could
 * quietly lie:
 *
 * 1. **Bars are scaled against the largest row, not against the total.** A bar
 *    drawn at its share of the total makes the top row 40% wide and everything
 *    below it a sliver, so the ranking stops being readable exactly where it
 *    starts being interesting. The share is still printed, as a number.
 *
 * 2. **Income and expenses get separate instances, never one list.** They are
 *    different questions, and one $60,000 salary on the same scale as the
 *    groceries would flatten every expense to a hairline. Rendering the two
 *    sides as two `RankedBars` gives each its own max and its own denominator
 *    for free, which is why there is no `groupBy` prop here.
 *
 * 3. **`Math.abs` for the width, signed value for the share.** A refund can
 *    push an expense category net negative (invariant 2 keeps that visible
 *    rather than clamping it); the bar shows its magnitude and the amount
 *    shows its sign.
 */
export type RankedBarRow = {
  key: string;
  label: ReactNode;
  /** Positive cents. The sign flip already happened in the query layer. */
  cents: number;
  /** Optional drilldown. Rendered as a plain link, so no client JS. */
  href?: string;
  note?: ReactNode;
};

export function RankedBars({
  rows,
  tone = "var(--money-out)",
  empty,
}: {
  rows: RankedBarRow[];
  tone?: string;
  empty?: ReactNode;
}) {
  // A book with no income categories touched yet, or an FY selected before
  // the data starts, is a real state and reaches here as an empty array.
  if (rows.length === 0) return <>{empty ?? null}</>;

  // Same guard as `DayBars`, for the same reason: every row zero would
  // otherwise divide by zero and render a row of NaN% widths.
  const max = Math.max(...rows.map((row) => Math.abs(row.cents)), 1);
  const total = rows.reduce((sum, row) => sum + row.cents, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((row) => {
        const body = (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 6,
              }}
            >
              <span
                className="mb-truncate"
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                  minWidth: 0,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  className="mb-num"
                  style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}
                >
                  {formatNZD(row.cents)}
                </span>
                {/* No denominator, no percentage. An all-zero set would
                    otherwise print "NaN%" or a confident 0% that reads like a
                    measurement rather than an absence. */}
                {total !== 0 && (
                  <span
                    className="mb-num"
                    style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
                  >
                    {Math.round((row.cents / total) * 100)}%
                  </span>
                )}
              </span>
            </div>

            <div
              style={{
                height: 6,
                borderRadius: "var(--radius-full)",
                background: "var(--surface-inset)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(Math.abs(row.cents) / max) * 100}%`,
                  minWidth: row.cents !== 0 ? 2 : 0,
                  background: tone,
                  borderRadius: "var(--radius-full)",
                }}
              />
            </div>

            {row.note && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                {row.note}
              </div>
            )}
          </>
        );

        return row.href ? (
          <Link
            key={row.key}
            href={row.href}
            className="mb-row-link"
            style={{ display: "block" }}
          >
            {body}
          </Link>
        ) : (
          <div key={row.key}>{body}</div>
        );
      })}
    </div>
  );
}

// Data-display components: the pace bar, the pace verdict, figures and the
// bar lists. All take integer cents, like everything else that touches money
// in this codebase, and render design.css classes.

import Link from "next/link";
import type { ReactNode } from "react";
import { formatNZD } from "@/lib/money";

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/**
 * A budget bar with an optional "where you'd be with even spending" marker.
 *
 * The marker is the whole point. A bar at 60% means nothing on its own — 60%
 * on day 6 of a month is a problem and 60% on day 27 is not.
 *
 * Spending past the marker is drawn hatched rather than recoloured, so being
 * behind pace reads by pattern as well as by colour: solid fill up to where
 * you should be, hatching for what you've spent beyond it.
 *
 * A zero budget gets the dashed "not budgeted" track, not an empty bar: no
 * budget is not the same as a budget with nothing spent.
 */
export function PaceBar({
  spentCents,
  budgetCents,
  markerPct = null,
  thick = false,
}: {
  spentCents: number;
  budgetCents: number;
  markerPct?: number | null;
  thick?: boolean;
  /** Kept for callers; the design has two heights, chosen by `thick`. */
  height?: number;
  tone?: string;
}) {
  if (budgetCents <= 0) return <div className="pace unb" aria-hidden="true" />;

  const pct = clampPct((spentCents / budgetCents) * 100);
  const mark = markerPct == null ? null : clampPct(markerPct);
  const solid = mark == null ? pct : Math.min(pct, mark);
  const over = mark != null && pct > mark ? pct - mark : 0;

  return (
    <div className={thick ? "pace thick" : "pace"} aria-hidden="true">
      <div className="fill" style={{ width: `${solid}%` }} />
      {over > 0 && <div className="over" style={{ left: `${mark}%`, width: `${over}%` }} />}
      {mark != null && <div className="mark" style={{ left: `${mark}%` }} />}
    </div>
  );
}

/**
 * The pace verdict. `deltaCents` positive means spent less than even pace.
 *
 * The words carry the direction ("Ahead of pace by", "Behind pace by");
 * colour and icon only reinforce it.
 */
export function Verdict({
  deltaCents,
  size = "md",
}: {
  deltaCents: number;
  size?: "md" | "lg";
  /** Kept for callers. */
  warningAtCents?: number;
}) {
  const style = size === "md" ? { padding: "2px 8px", fontSize: 13 } : undefined;
  if (deltaCents === 0) {
    return (
      <span className="delta even" style={style}>
        On pace
      </span>
    );
  }
  const ahead = deltaCents > 0;
  return (
    <span className={`delta ${ahead ? "ahead" : "behind"}`} style={style}>
      <span className={`i ${ahead ? "i-check" : "i-warn"} sm`} aria-hidden="true" />
      {ahead ? "Ahead of pace by " : "Behind pace by "}
      <span className="num">{formatNZD(Math.abs(deltaCents))}</span>
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
    <div className="row between" style={{ gap: 12, fontSize: 15 }}>
      <span className="ink2">{label}</span>
      <span className={mono ? "m" : undefined} style={{ color: tone, textAlign: "right" }}>
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
    <div className="stack" style={{ gap: 2 }}>
      <span className="t-xs ink3">{label}</span>
      <span className="m" style={{ fontSize: 18, color: tone }}>
        {value}
      </span>
      {note && (
        <span className="t-xs" style={{ color: noteTone ?? "var(--ink-3)" }}>
          {note}
        </span>
      )}
    </div>
  );
}

/**
 * Daily spend bars across a period.
 *
 * Days after today are drawn as dashed outlines rather than omitted, so the
 * shape of the chart is the shape of the period — you can see how much
 * runway is left without reading an axis. Today is drawn in ink.
 */
export function DayBars({
  series,
}: {
  series: { label: string; cents: number; future: boolean; today?: boolean }[];
}) {
  const max = Math.max(...series.map((s) => s.cents), 1);
  return (
    <div
      className="daybars"
      style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}
    >
      {series.map((s, i) => {
        const cls = s.future ? "b f" : s.cents <= 0 ? "b z" : s.today ? "b t" : "b";
        return (
          <div
            key={i}
            className={cls}
            title={`${s.label}: ${formatNZD(s.cents)}`}
            style={s.future || s.cents <= 0 ? undefined : { height: `${(s.cents / max) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

/** Screen title, optional subtitle, optional actions on the right. */
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
    <div className="page-h">
      <div className="grow stack" style={{ gap: 6 }}>
        <h1 className="t-xl">{title}</h1>
        {sub && <span className="t-s ink2">{sub}</span>}
      </div>
      {right && (
        <div className="row wrap" style={{ gap: 10 }}>
          {right}
        </div>
      )}
    </div>
  );
}

/**
 * A ranked bar list — rank, label, share bar, share %, amount.
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
  income = false,
  empty,
}: {
  rows: RankedBarRow[];
  /** Money in: green bars and a leading plus. */
  income?: boolean;
  /** Kept for callers; the side is chosen by `income`. */
  tone?: string;
  empty?: ReactNode;
}) {
  // A book with no income categories touched yet, or an FY selected before
  // the data starts, is a real state and reaches here as an empty array.
  if (rows.length === 0) return <>{empty ?? null}</>;

  // Every row zero would otherwise divide by zero and render NaN% widths.
  const max = Math.max(...rows.map((row) => Math.abs(row.cents)), 1);
  const total = rows.reduce((sum, row) => sum + row.cents, 0);

  return (
    <div>
      {rows.map((row, i) => {
        const body = (
          <>
            <span className="no">{String(i + 1).padStart(2, "0")}</span>
            <span className="n">
              <span className="mb-truncate" style={{ display: "block" }}>
                {row.label}
              </span>
              {row.note && <span className="t-xs ink3">{row.note}</span>}
            </span>
            <div className={income ? "share in" : "share"}>
              <div
                className="fill"
                style={{
                  width: `${(Math.abs(row.cents) / max) * 100}%`,
                  minWidth: row.cents !== 0 ? 2 : 0,
                }}
              />
            </div>
            {/* No denominator, no percentage: an all-zero set would otherwise
                print "NaN%" or a confident 0% that reads like a measurement
                rather than an absence. */}
            <span className="p">
              {total !== 0 ? `${Math.round((row.cents / total) * 100)}%` : ""}
            </span>
            <span className={income ? "a m in" : "a m"}>
              {income && row.cents > 0 ? "+" : ""}
              {formatNZD(row.cents)}
            </span>
          </>
        );

        return row.href ? (
          <Link key={row.key} href={row.href} className="rk mb-row-link">
            {body}
          </Link>
        ) : (
          <div key={row.key} className="rk">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** A money figure in the mono. `dir="in"` adds the plus and the green. */
export function Money({
  cents,
  dir,
  big = false,
}: {
  cents: number;
  dir?: "in" | "out" | "net";
  big?: boolean;
}) {
  const sign = dir === "in" ? "+" : dir === "net" ? (cents > 0 ? "+" : cents < 0 ? "−" : "") : "";
  const shown = dir === "net" ? Math.abs(cents) : cents;
  return (
    <span
      className={`m${dir === "in" ? " in" : ""}${big ? " big" : ""}`}
      style={dir === "net" ? { fontWeight: 800 } : undefined}
    >
      {sign}
      {formatNZD(shown)}
    </span>
  );
}

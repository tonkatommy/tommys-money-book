"use client";

// The budget-vs-spent trend, and the app's first client-rendered content.
//
// Everything else in this app server-renders complete HTML — the setup,
// review and IR3 forms are client components, but only for `useActionState`,
// and each one works fully with JavaScript off. Recharts is different, and it
// was measured rather than assumed: rendering a fixed-size chart through
// `react-dom/server` produces `<div class="recharts-wrapper">` and nothing
// else. No `<svg>`, no bars, no axis. It computes its layout in browser
// effects. 4b spec §6.
//
// So this component is an ENHANCEMENT, never a source of figures:
//
//   - The table beside it is server-rendered and carries every number. This
//     draws the same array the table renders, passed as plain props.
//   - It renders nothing at all until it has mounted. Reserving an empty
//     300px box would leave a blank rectangle on a no-JS page, which looks
//     broken; no chart at all just looks like a table. The cost is a layout
//     shift when it appears, which is the right trade for a page whose job is
//     the numbers.
//
// Per this Next version's server-and-client-components guide, a third-party
// component relying on client-only features is wrapped in our own Client
// Component — Recharts ships no "use client" of its own, so it is imported
// here and nowhere else.

import { useSyncExternalStore } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { centsToDollars, formatNZD, formatNZDWhole } from "@/lib/money";

/** One period, already flipped to positive cents by the query layer. */
export type TrendPoint = {
  label: string;
  /** Null for a period with no budget — not zero. The line breaks there. */
  allowanceCents: number | null;
  /** Spent in categories that HAD a budget that period. */
  spentCents: number;
  /**
   * Spent in categories that didn't, stacked on top.
   *
   * Without this the chart draws a period with no budgets as an empty column
   * — "nothing was spent" — while the table beside it reads $8,555.58. The
   * bar has to carry both parts for the two to agree, and stacking keeps them
   * distinguishable rather than merging into one figure that means neither.
   */
  unbudgetedSpentCents?: number;
};

/** Design-token fallbacks, used only if a token is missing. */
const FALLBACK = {
  out: "#f59e0b",
  line: "#a1a1aa",
  grid: "#27272a",
  text: "#71717a",
  card: "#18181b",
} as const;

/**
 * Whether we are past the server render.
 *
 * `useSyncExternalStore` with a never-firing subscription: the server
 * snapshot is false, the client snapshot is true, and it resolves in one pass
 * with no state update. An effect calling `setState` would do the same job by
 * rendering twice, which is what `react-hooks/set-state-in-effect` objects to.
 */
const NEVER = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    NEVER,
    () => true,
    () => false,
  );
}

/**
 * Token values, read from the document.
 *
 * Recharts writes colours into SVG presentation attributes, where a CSS
 * `var()` is not reliably resolved across browsers. Reading the computed
 * values keeps the chart on the design tokens rather than hardcoding hexes
 * that would drift the first time the palette changes.
 *
 * Read during render rather than held in state: this only ever runs on the
 * client (the component returns null before that), it is a handful of
 * property reads, and the alternative is a second render to deliver colours
 * that were available all along.
 */
function readTokens() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  return {
    out: read("--money-out", FALLBACK.out),
    line: read("--text-secondary", FALLBACK.line),
    grid: read("--border-subtle", FALLBACK.grid),
    text: read("--text-muted", FALLBACK.text),
    card: read("--surface-card-raised", FALLBACK.card),
  };
}

export function BudgetTrendChart({ points }: { points: TrendPoint[] }) {
  const mounted = useMounted();

  // Nothing on the server, and nothing before hydration. The table below is
  // already showing every figure on this chart.
  if (!mounted) return null;

  const tokens = readTokens();

  // Recharts works in numbers it will format; cents would render as an axis
  // of six-figure integers. Dollars here are for DRAWING only — every figure
  // the reader sees comes back through `formatNZD` from the original cents.
  const data = points.map((p) => ({
    label: p.label,
    spent: centsToDollars(p.spentCents),
    unbudgeted: centsToDollars(p.unbudgetedSpentCents ?? 0),
    allowance: p.allowanceCents === null ? null : centsToDollars(p.allowanceCents),
  }));

  const anyUnbudgeted = points.some((p) => (p.unbudgetedSpentCents ?? 0) !== 0);

  return (
    <div style={{ width: "100%", height: 260, marginBottom: "var(--space-5)" }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={tokens.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: tokens.text, fontSize: 11 }}
            axisLine={{ stroke: tokens.grid }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: tokens.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
            tickFormatter={(value: number) => formatNZDWhole(Math.round(value * 100))}
          />
          <Tooltip
            contentStyle={{
              background: tokens.card,
              border: `1px solid ${tokens.grid}`,
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: tokens.text }}
            formatter={(value, name) => [
              // Back through the cents, so the tooltip cannot disagree with
              // the table by a rounding step. A period with no budget arrives
              // here as null — and as undefined once Recharts has been
              // through it — so both say so rather than rendering "$0.00".
              typeof value === "number" ? formatNZD(Math.round(value * 100)) : "no budget",
              name === "spent" ? "Spent" : name === "unbudgeted" ? "Not budgeted" : "Budget",
            ]}
          />
          {/* Stacked, so a period's column is its whole spending: the
              budgeted part in the money-out tone, anything outside the budget
              muted on top. A period with no budget at all is one muted bar,
              which is the table's "none of it budgeted" row drawn. */}
          <Bar
            dataKey="spent"
            stackId="spent"
            fill={tokens.out}
            radius={anyUnbudgeted ? 0 : [3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="unbudgeted"
            stackId="spent"
            fill={tokens.grid}
            stroke={tokens.line}
            strokeWidth={1}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          {/* Stepped, because a budget holds flat until someone changes it —
              sloping between periods would draw a change that never happened.
              `connectNulls={false}` leaves a gap over periods with no budget
              rather than bridging them as if one applied. */}
          <Line
            type="stepAfter"
            dataKey="allowance"
            stroke={tokens.line}
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

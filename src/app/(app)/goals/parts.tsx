// The goal card and history table, shared by /goals and /goals/[id].
//
// Server components. The progress bar is a div width, not a chart, so it
// renders complete with JavaScript disabled (4c spec §1: no chart library on
// these routes). Every figure comes from `GoalView`; nothing here does money
// arithmetic, only formatting.

import Link from "next/link";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import { Figure, KV } from "@/components/ui/data";
import { formatNZD } from "@/lib/money";
import { nzDate, nzToday } from "@/lib/budget/period";
import type { GoalView, HistoryRow } from "@/lib/goals/query";
import type { Projection } from "@/lib/goals/pace";

const muted = { fontSize: "var(--text-xs)", color: "var(--text-muted)" } as const;

/**
 * Whole percent, rounded DOWN. 99.6% reads as 99%: rounding to nearest would
 * print "100%" beside a goal that hasn't been reached, which is the one
 * figure on this card that must never be optimistic.
 */
function percentText(percent: number): string {
  return `${Math.floor(percent)}%`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function projectionText(projection: Projection): string | null {
  switch (projection.status) {
    case "reached":
      return null;
    case "no-history":
      return "No complete pay period of history yet, so no projection.";
    case "not-growing":
      return "Not growing at the current rate, so there is no date to project.";
    case "too-far":
      return "At the current rate this is more than 50 years away.";
    case "on-date":
      return `At the current rate, reached by ${nzDate(projection.by)} (${plural(projection.periods, "pay period")}).`;
  }
}

function ProgressBar({ barPercent }: { barPercent: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        height: 8,
        borderRadius: "var(--radius-full)",
        background: "var(--surface-inset)",
        border: "1px solid var(--border-subtle)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${barPercent}%`,
          height: "100%",
          background: "var(--money-in)",
        }}
      />
    </div>
  );
}

export function GoalCard({ goal, link = false }: { goal: GoalView; link?: boolean }) {
  const { pace } = goal;
  const hidden = goal.warnings.some((warning) => warning.hidesFigures);

  const title = link ? <Link href={`/goals/${goal.id}`}>{goal.name}</Link> : goal.name;

  return (
    <Card
      title={title}
      action={
        pace?.progress.reached ? (
          <Badge tone="ok">Reached</Badge>
        ) : pace?.onTrack === true ? (
          <Badge tone="ok">On track</Badge>
        ) : pace?.onTrack === false ? (
          <Badge tone="warning">Behind</Badge>
        ) : undefined
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={muted}>
          Saved in {goal.account.name}
          {goal.balanceAsAt && !hidden && (
            <> · balance as at {nzDate(nzToday(goal.balanceAsAt))}</>
          )}
        </div>

        {goal.warnings.map((warning) => (
          <Alert key={warning.message} level={warning.level}>
            {warning.message}
          </Alert>
        ))}

        {hidden || !pace || goal.balanceCents === null ? (
          <KV label="Target" value={formatNZD(goal.targetCents)} />
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                gap: "var(--space-4)",
              }}
            >
              <Figure
                label="Balance"
                value={formatNZD(goal.balanceCents)}
                tone={goal.balanceCents < 0 ? "var(--status-error)" : undefined}
              />
              <Figure label="Target" value={formatNZD(goal.targetCents)} />
              {pace.progress.reached ? (
                <Figure
                  label="Over target by"
                  value={formatNZD(pace.progress.overshootCents)}
                  tone="var(--money-in)"
                />
              ) : (
                <Figure label="Still to go" value={formatNZD(pace.progress.remainingCents)} />
              )}
            </div>

            {pace.progress.barPercent !== null && pace.progress.percent !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <ProgressBar barPercent={pace.progress.barPercent} />
                <span style={muted}>{percentText(pace.progress.percent)} of target</span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {goal.targetDate && pace.periodsLeft !== null && (
                pace.periodsLeft === 0 ? (
                  <KV
                    label={`Target date ${nzDate(goal.targetDate)}`}
                    value={
                      pace.progress.reached
                        ? "reached"
                        : pace.datePassed
                          ? "passed"
                          : "no payday left before it"
                    }
                    tone={pace.progress.reached ? undefined : "var(--status-warning)"}
                    mono={false}
                  />
                ) : (
                  <>
                    <KV
                      label={`Target date ${nzDate(goal.targetDate)}`}
                      value={plural(pace.periodsLeft, "pay period") + " left"}
                      mono={false}
                    />
                    {!pace.progress.reached && pace.requiredPerPeriodCents !== null && (
                      <KV
                        label="Needed each pay period"
                        value={formatNZD(pace.requiredPerPeriodCents)}
                      />
                    )}
                  </>
                )
              )}

              {!pace.progress.reached && (
                <KV
                  label={
                    pace.averageContributionCents === null
                      ? "Average put in"
                      : `Average put in, last ${plural(pace.averagedOver, "pay period")}`
                  }
                  value={
                    pace.averageContributionCents === null
                      ? "no history yet"
                      : formatNZD(pace.averageContributionCents)
                  }
                  tone={
                    pace.averageContributionCents !== null && pace.averageContributionCents < 0
                      ? "var(--money-out)"
                      : undefined
                  }
                />
              )}
            </div>

            {projectionText(pace.projection) && (
              <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                {projectionText(pace.projection)}
              </p>
            )}
          </>
        )}

        {goal.note && (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            {goal.note}
          </p>
        )}
      </div>
    </Card>
  );
}

const cell = { padding: "10px 14px 10px 0" } as const;
const numeric = { ...cell, textAlign: "right" } as const;

/**
 * The periods behind the average, oldest first. The average on the card is
 * exactly the mean of the counted rows here, so it can be checked by eye.
 */
export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const anyUncounted = rows.some((row) => !row.counted);
  const anyClosing = rows.some((row) => row.closingBalanceCents !== null);

  return (
    <Card title="Pay period by pay period">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
          <thead>
            <tr style={{ ...muted, textAlign: "left" }}>
              <th style={cell}>Period</th>
              <th style={numeric}>Net in</th>
              {anyClosing && <th style={numeric}>Closing balance</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.period.start.toISOString()}
                style={{
                  borderTop: "1px solid var(--border-subtle)",
                  color: row.counted ? undefined : "var(--text-muted)",
                }}
              >
                <td style={cell}>
                  {nzDate(row.period.start)} – {nzDate(row.period.end)}
                  {!row.counted && " *"}
                </td>
                <td
                  className="mb-num"
                  style={{
                    ...numeric,
                    color: row.counted && row.netFlowCents < 0 ? "var(--money-out)" : undefined,
                  }}
                >
                  {formatNZD(row.netFlowCents)}
                </td>
                {anyClosing && (
                  <td className="mb-num" style={numeric}>
                    {row.closingBalanceCents === null ? "—" : formatNZD(row.closingBalanceCents)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyUncounted && (
        <p style={{ ...muted, margin: "var(--space-3) 0 0" }}>
          * Before or across the start of the bank feed&apos;s history, so only
          part of the period is in the data. Shown, but left out of the
          average.
        </p>
      )}
    </Card>
  );
}

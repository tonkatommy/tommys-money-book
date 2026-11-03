// The goal card and history table, shared by /goals and /goals/[id].
//
// Server components. The progress meter is a div width, not a chart, so it
// renders complete with JavaScript disabled (4c spec §1: no chart library on
// these routes). Every figure comes from `GoalView`; nothing here does money
// arithmetic, only formatting.
//
// Markup follows the canvas's Goals and GoalDetail artboards.

import Link from "next/link";
import { Alert } from "@/components/ui/primitives";
import { formatNZD } from "@/lib/money";
import { dateRange, nzDate, nzToday } from "@/lib/budget/period";
import type { GoalView, HistoryRow } from "@/lib/goals/query";
import type { Projection } from "@/lib/goals/pace";

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
      return "Not growing at the current rate, so there's no date to project.";
    case "too-far":
      return "At the current rate this is more than 50 years away.";
    case "on-date":
      return `${nzDate(projection.by)} at the current rate (${plural(projection.periods, "pay period")}).`;
  }
}

function Status({ goal }: { goal: GoalView }) {
  const pace = goal.pace;
  if (pace?.progress.reached) return <span className="delta ahead">Reached</span>;
  if (pace?.onTrack === true) return <span className="delta ahead">On track</span>;
  if (pace?.onTrack === false) return <span className="delta behind">Behind</span>;
  return null;
}

/**
 * One goal. `link` makes the whole card the way into its detail page, as on
 * the list; the detail page shows it unlinked with the history beside it.
 */
export function GoalCard({ goal, link = false }: { goal: GoalView; link?: boolean }) {
  const { pace } = goal;
  const hidden = goal.warnings.some((warning) => warning.hidesFigures);

  const body = (
    <>
      <div className="row between wrap">
        <span className="stack" style={{ gap: 2 }}>
          <span className="t-l">{goal.name}</span>
          <span className="range">
            {goal.account.name}
            {goal.balanceAsAt && !hidden && <> · balance as at {nzDate(nzToday(goal.balanceAsAt))}</>}
          </span>
        </span>
        <Status goal={goal} />
      </div>

      {goal.warnings.map((warning) => (
        <Alert key={warning.message} level={warning.level}>
          {warning.message}
        </Alert>
      ))}

      {hidden || !pace || goal.balanceCents === null ? (
        <div className="row wrap" style={{ alignItems: "baseline", gap: 10 }}>
          <span className="na">balance not trusted</span>
          <span className="t-s ink2">target {formatNZD(goal.targetCents)}</span>
        </div>
      ) : (
        <>
          <div className="row wrap" style={{ alignItems: "baseline", gap: 10 }}>
            <span
              className="m"
              style={{ fontSize: 32, color: goal.balanceCents < 0 ? "var(--bad)" : undefined }}
            >
              {formatNZD(goal.balanceCents)}
            </span>
            <span className="t-s ink2">of {formatNZD(goal.targetCents)}</span>
            {pace.progress.percent !== null && (
              <span className="badge">{percentText(pace.progress.percent)}</span>
            )}
          </div>
          {pace.progress.barPercent !== null && (
            <div className="meter" aria-hidden="true">
              <div
                className="fill"
                style={{ width: `${pace.progress.barPercent}%`, background: "var(--accent)" }}
              />
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
            <div className="stack">
              <span className="t-xs ink3">{pace.progress.reached ? "Over target by" : "To go"}</span>
              <span className={pace.progress.reached ? "m in" : "m"}>
                {formatNZD(
                  pace.progress.reached ? pace.progress.overshootCents : pace.progress.remainingCents,
                )}
              </span>
            </div>
            <div className="stack">
              <span className="t-xs ink3">Target date</span>
              <span className="t-s">
                {goal.targetDate ? nzDate(goal.targetDate) : <span className="na">none set</span>}
                {goal.targetDate && pace.periodsLeft !== null && pace.periodsLeft > 0 && (
                  <span className="ink3"> · {plural(pace.periodsLeft, "pay period")} left</span>
                )}
                {goal.targetDate && pace.periodsLeft === 0 && !pace.progress.reached && (
                  <span style={{ color: "var(--warn)" }}>
                    {" "}
                    · {pace.datePassed ? "passed" : "no payday left before it"}
                  </span>
                )}
              </span>
            </div>
            {!pace.progress.reached && (
              <>
                <div className="stack">
                  <span className="t-xs ink3">Needed per pay period</span>
                  <span className="m">
                    {pace.requiredPerPeriodCents !== null ? (
                      formatNZD(pace.requiredPerPeriodCents)
                    ) : (
                      <span className="na">{goal.targetDate ? "—" : "no date"}</span>
                    )}
                  </span>
                </div>
                <div className="stack">
                  <span className="t-xs ink3">
                    Recent average saved
                    {pace.averageContributionCents !== null &&
                      ` · ${plural(pace.averagedOver, "period")}`}
                  </span>
                  <span
                    className="m"
                    style={{
                      color:
                        pace.averageContributionCents !== null && pace.averageContributionCents < 0
                          ? "var(--bad)"
                          : undefined,
                    }}
                  >
                    {pace.averageContributionCents === null ? (
                      <span className="na">no history yet</span>
                    ) : (
                      formatNZD(pace.averageContributionCents)
                    )}
                  </span>
                </div>
              </>
            )}
          </div>

          {projectionText(pace.projection) && (
            <>
              <div className="hr" />
              <p className="t-s">
                <span className="semi">Projected finish:</span>{" "}
                <span className="ink2">{projectionText(pace.projection)}</span>
              </p>
            </>
          )}
        </>
      )}

      {goal.note && <p className="t-s ink2">{goal.note}</p>}
    </>
  );

  return link ? (
    <Link className="card pad-l stack" href={`/goals/${goal.id}`} style={{ gap: 14 }}>
      {body}
    </Link>
  ) : (
    <section className="card pad-l stack" style={{ gap: 14 }} aria-label={goal.name}>
      {body}
    </section>
  );
}

/**
 * The periods behind the average, oldest first. The average on the card is
 * exactly the mean of the counted rows here, so it can be checked by eye.
 */
export function HistoryTable({
  rows,
  averageCents,
}: {
  rows: HistoryRow[];
  averageCents: number | null;
}) {
  const anyUncounted = rows.some((row) => !row.counted);
  const anyClosing = rows.some((row) => row.closingBalanceCents !== null);

  return (
    <section className="card" style={{ padding: 0, overflow: "hidden" }} aria-label="Pay periods behind the average">
      <div className="grp-h">
        <span className="sect-t">Behind the average</span>
        <span className="range">complete pay periods</span>
      </div>
      <div className="scroll">
        <table className="tbl tight">
          <thead>
            <tr>
              <th>Pay period</th>
              <th className="num">Saved</th>
              {anyClosing && <th className="num">Closing balance</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period.start.toISOString()} className={row.counted ? undefined : "ink3"}>
                <td className="range" style={{ fontSize: 13 }}>
                  {dateRange(row.period.start, row.period.end)}
                  {!row.counted && " *"}
                </td>
                <td className="num" style={{ color: row.counted && row.netFlowCents < 0 ? "var(--bad)" : undefined }}>
                  {formatNZD(row.netFlowCents)}
                </td>
                {anyClosing && (
                  <td className="num">
                    {row.closingBalanceCents === null ? "—" : formatNZD(row.closingBalanceCents)}
                  </td>
                )}
              </tr>
            ))}
            {averageCents !== null && (
              <tr className="tot">
                <td>Average</td>
                <td className="num">{formatNZD(averageCents)}</td>
                {anyClosing && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="t-xs ink3" style={{ padding: "12px 16px" }}>
        Saved is the change in the account&apos;s balance over the period, interest
        included. The current period isn&apos;t counted until it ends.
        {anyUncounted &&
          " * Before or across the start of the bank feed's history, so only part of the period is in the data: shown, but left out of the average."}
      </p>
    </section>
  );
}

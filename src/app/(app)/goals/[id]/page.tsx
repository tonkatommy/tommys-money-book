// One savings goal: the card, the pay periods behind its average, and the
// edit and archive forms.
//
// The history table is the same array the average was computed from, so the
// "recent average saved" on the card is the mean of the unstarred rows here
// and can be checked by eye. An archived goal shows bare — no pace, no
// history — and can only be restored, which is where its account gets
// re-checked, or deleted. Delete is offered here and nowhere else: an active
// goal is two deliberate steps from gone.
//
// Layout follows the Money Book canvas (GoalDetail.dc.html).

import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/ui/primitives";
import { formatNZD } from "@/lib/money";
import { nzDate, nzToday } from "@/lib/budget/period";
import { resolvePeriod } from "@/lib/budget/query";
import { iso } from "@/lib/reports/fy";
import { DELETE_CONFIRMATION } from "@/lib/goals/mutate";
import { getGoalAccountOptions, getGoalDetail } from "@/lib/goals/query";
import { ArchiveButton, DeleteGoalForm, GoalForm } from "../forms";
import { GoalCard, HistoryTable } from "../parts";

export const dynamic = "force-dynamic";

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const now = new Date();
  const { period, settings } = await resolvePeriod(undefined, now);
  const [goal, accounts] = await Promise.all([
    getGoalDetail(id, settings.anchorDay, now),
    getGoalAccountOptions(),
  ]);
  if (!goal) notFound();

  const archived = goal.archivedAt !== null;

  return (
    <AppShell
      active="goals"
      book="PERSONAL"
      // Goals are personal only, so the toggle would have nothing to toggle.
      lockBook
      period={period}
      basePath={`/goals/${id}`}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="stack" style={{ gap: 16, width: "100%", maxWidth: 1040 }}>
        <Link href="/goals" className="row t-s semi" style={{ textDecoration: "none", minHeight: 44 }}>
          <Icon name="back" size="sm" />
          Savings goals
        </Link>

        {archived ? (
          <>
            <div className="page-h">
              <div className="grow stack" style={{ gap: 6 }}>
                <div className="row">
                  <span className="badge">
                    <Icon name="archive" />
                    Archived {nzDate(nzToday(goal.archivedAt!))}
                  </span>
                </div>
                <h1 className="t-xl">{goal.name}</h1>
                <span className="range">
                  {formatNZD(goal.targetCents)} in {goal.account.name}
                  {goal.targetDate ? `, by ${nzDate(goal.targetDate)}` : ""} · not tracked
                  while archived
                </span>
              </div>
              <ArchiveButton id={goal.id} archived />
            </div>
            <p className="t-xs ink3">
              Restoring re-checks that the account is still personal and has no
              other active goal.
            </p>
            <section
              className="card pad-l stack"
              style={{ gap: 14, maxWidth: 620, borderColor: "var(--bad-line)" }}
              aria-label="Delete goal"
            >
              <h2 className="t-m">Delete this goal</h2>
              <p className="t-s ink2">
                Removes the goal for good. No figure anywhere changes: a goal stores
                no money, only a target against {goal.account.name}&apos;s balance.
                The bank account and its transactions stay exactly as they are.
              </p>
              <DeleteGoalForm id={goal.id} name={goal.name} confirmValue={DELETE_CONFIRMATION} />
            </section>
          </>
        ) : (
          <>
            <div className="page-h">
              <div className="grow stack" style={{ gap: 6 }}>
                <h1 className="t-xl">{goal.name}</h1>
                <span className="range">Personal book · {goal.account.name}</span>
              </div>
              <ArchiveButton id={goal.id} archived={false} />
            </div>

            <div className="grid cols-main" style={{ gap: 20, alignItems: "start" }}>
              <GoalCard goal={goal} />
              {goal.history.length > 0 && (
                <HistoryTable
                  rows={goal.history}
                  averageCents={goal.pace?.averageContributionCents ?? null}
                />
              )}
            </div>

            <GoalForm
              accounts={accounts}
              goal={{
                id: goal.id,
                name: goal.name,
                accountId: goal.account.id,
                targetCents: goal.targetCents,
                // Edit allows a past date (4c spec §5), so no `min` here.
                targetDate: goal.targetDate ? iso(goal.targetDate) : "",
                note: goal.note ?? "",
              }}
            />
            <p className="t-xs ink3">
              Archiving stops tracking this goal and frees {goal.account.name} for
              another. Delete becomes available once a goal is archived; the bank
              account is never touched.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

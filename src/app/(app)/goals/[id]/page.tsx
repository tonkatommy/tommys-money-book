// One savings goal: the card, the pay periods behind its average, and the
// edit and archive forms.
//
// The history table is the same array the average was computed from, so the
// "average put in" on the card is the mean of the unstarred rows here and can
// be checked by eye. An archived goal shows bare — no pace, no history — and
// can only be unarchived, which is where its account gets re-checked, or
// deleted. Delete is offered here and nowhere else: an active goal is two
// deliberate steps from gone.

import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ButtonLink, Card } from "@/components/ui/primitives";
import { ScreenHead } from "@/components/ui/data";
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
      active="budget"
      book="PERSONAL"
      // Goals are personal only, so the toggle would have nothing to toggle.
      lockBook
      period={period}
      basePath={`/goals/${id}`}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title={goal.name}
          sub={archived ? `Archived ${nzDate(nzToday(goal.archivedAt!))}.` : undefined}
          right={
            <ButtonLink href="/goals" variant="ghost" size="sm">
              All goals
            </ButtonLink>
          }
        />

        {archived ? (
          <>
            <Card title="Archived">
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  {formatNZD(goal.targetCents)} in {goal.account.name}
                  {goal.targetDate ? `, by ${nzDate(goal.targetDate)}` : ""}. Not
                  tracked while archived. Unarchiving re-checks that the account
                  is still personal and has no other active goal.
                </p>
                <ArchiveButton id={goal.id} archived />
              </div>
            </Card>
            <Card title="Delete">
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                  Removes the goal for good. No figure anywhere changes: a goal
                  stores no money, only a target against {goal.account.name}&apos;s
                  balance. Archiving keeps it; deleting can&apos;t be undone.
                </p>
                <DeleteGoalForm id={goal.id} name={goal.name} confirmValue={DELETE_CONFIRMATION} />
              </div>
            </Card>
          </>
        ) : (
          <>
            <GoalCard goal={goal} />
            {goal.history.length > 0 && <HistoryTable rows={goal.history} />}
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
            <Card title="Archive">
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                  Archiving stops tracking this goal and frees{" "}
                  {goal.account.name} for another. Nothing is deleted, and it
                  can be brought back.
                </p>
                <ArchiveButton id={goal.id} archived={false} />
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

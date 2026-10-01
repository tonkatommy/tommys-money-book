// Savings goals: every active goal against its account's balance.
//
// Personal book only (4c spec §1), so there is no `?book=` toggle and the
// heading says so. Reached from a link on /budget rather than a nav item: the
// bottom tab bar already shares its width between seven.
//
// A goal measures its account's Akahu balance — nothing about progress is
// stored — so each card carries its own warnings when that balance can't be
// trusted, and a goal whose account has left the personal book stays on the
// list saying so rather than quietly disappearing.

import { AppShell } from "@/components/app-shell";
import { ButtonLink, Card, EmptyState } from "@/components/ui/primitives";
import { ScreenHead } from "@/components/ui/data";
import { formatNZD } from "@/lib/money";
import { nzDate, nzToday } from "@/lib/budget/period";
import { resolvePeriod } from "@/lib/budget/query";
import { getGoals } from "@/lib/goals/query";
import { GoalCard } from "./parts";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  // One instant for the whole render, so the period in the shell header and
  // the window behind every average can't straddle payday.
  const now = new Date();
  const { period, settings } = await resolvePeriod(undefined, now);
  const { active, archived } = await getGoals(settings.anchorDay, now);

  return (
    <AppShell
      active="budget"
      book="PERSONAL"
      // Goals are personal only, so the toggle would have nothing to toggle.
      lockBook
      period={period}
      basePath="/goals"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Savings goals"
          sub="Personal book. Each goal tracks one savings account's balance, as the bank reports it, against a target."
          right={
            <ButtonLink href="/goals/new" variant="primary" size="sm">
              New goal
            </ButtonLink>
          }
        />

        {active.length === 0 ? (
          <Card>
            <EmptyState
              title="No goals yet"
              body="A goal points at one of your savings accounts and measures its balance against a target, with what needs to go in each pay period to hit a date."
              action={
                <ButtonLink href="/goals/new" variant="primary" size="sm">
                  Set a goal
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          active.map((goal) => <GoalCard key={goal.id} goal={goal} link />)
        )}

        {archived.length > 0 && (
          // <details> so the archived list works with JavaScript disabled.
          <details>
            <summary style={{ cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              Archived ({archived.length})
            </summary>
            <Card>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {archived.map((goal) => (
                  <li key={goal.id} style={{ fontSize: "var(--text-sm)" }}>
                    <a href={`/goals/${goal.id}`}>{goal.name}</a>{" "}
                    <span style={{ color: "var(--text-muted)" }}>
                      · {formatNZD(goal.targetCents)} in {goal.account.name} · archived{" "}
                      {nzDate(nzToday(goal.archivedAt!))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </details>
        )}
      </div>
    </AppShell>
  );
}

// Savings goals: every active goal against its account's balance.
//
// Personal book only (4c spec §1), so the header shows a locked label rather
// than the toggle. Reached from Budget and from the sidebar, where it sits
// under Budget.
//
// A goal measures its account's Akahu balance — nothing about progress is
// stored — so each card carries its own warnings when that balance can't be
// trusted, and a goal whose account has left the personal book stays on the
// list saying so rather than quietly disappearing.
//
// Layout follows the Money Book canvas (Goals.dc.html).

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EmptyState, Icon } from "@/components/ui/primitives";
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
      active="goals"
      book="PERSONAL"
      // Goals are personal only, so the toggle would have nothing to toggle.
      lockBook
      period={period}
      basePath="/goals"
      splitFortnightly={settings.splitFortnightly}
    >
      <Link href="/budget" className="row t-s semi" style={{ textDecoration: "none", minHeight: 44 }}>
        <Icon name="back" size="sm" />
        Budget
      </Link>
      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Savings goals</h1>
          <span className="t-s ink2">
            Each goal is one savings account&apos;s balance, as the bank reports it,
            against a target. Display only: goals don&apos;t change Budget.
          </span>
        </div>
        <Link className="btn primary" href="/goals/new">
          <Icon name="plus" size="sm" />
          New goal
        </Link>
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon="target"
          title="No goals yet"
          body="A goal points at one of your savings accounts and measures its balance against a target, with what needs to go in each pay period to hit a date."
          action={
            <Link className="btn primary" href="/goals/new">
              Set a goal
            </Link>
          }
        />
      ) : (
        <div className="grid cols-2" style={{ gap: 20 }}>
          {active.map((goal) => (
            <GoalCard key={goal.id} goal={goal} link />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <section className="stack" style={{ gap: 10 }} aria-label="Archived goals">
          <h2 className="t-m ink2">Archived · {archived.length}</h2>
          {archived.map((goal) => (
            <Link
              key={goal.id}
              className="card row"
              href={`/goals/${goal.id}`}
              style={{ background: "transparent", borderStyle: "dashed" }}
            >
              <span className="ink3">
                <Icon name="archive" />
              </span>
              <span className="grow stack">
                <span className="semi">{goal.name}</span>
                <span className="t-xs ink3">
                  {formatNZD(goal.targetCents)} in {goal.account.name} · archived{" "}
                  {nzDate(nzToday(goal.archivedAt!))}
                </span>
              </span>
              <Icon name="chev" size="sm" />
            </Link>
          ))}
        </section>
      )}
    </AppShell>
  );
}

// A new savings goal. Layout follows the canvas's GoalDetail artboard in its
// "new" state.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EmptyState, Icon } from "@/components/ui/primitives";
import { nzToday, utcDate } from "@/lib/budget/period";
import { resolvePeriod } from "@/lib/budget/query";
import { iso } from "@/lib/reports/fy";
import { getGoalAccountOptions } from "@/lib/goals/query";
import { GoalForm } from "../forms";

export const dynamic = "force-dynamic";

export default async function NewGoalPage() {
  const now = new Date();
  const { period, settings } = await resolvePeriod(undefined, now);
  const accounts = await getGoalAccountOptions();

  // The date picker's floor is tomorrow in NZ. Only a convenience: the
  // create-only rule is enforced in `parseGoalForm`.
  const today = nzToday(now);
  const tomorrow = utcDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);

  return (
    <AppShell
      active="goals"
      book="PERSONAL"
      // Goals are personal only, so the toggle would have nothing to toggle.
      lockBook
      period={period}
      basePath="/goals/new"
      splitFortnightly={settings.splitFortnightly}
    >
      <Link href="/goals" className="row t-s semi" style={{ textDecoration: "none", minHeight: 44 }}>
        <Icon name="back" size="sm" />
        Savings goals
      </Link>
      <h1 className="t-xl">New goal</h1>

      {accounts.length === 0 ? (
        <EmptyState
          icon="target"
          title="No personal account to save in"
          body="A goal needs a bank-fed account in the personal book. Run npm run accounts:map if one is still unassigned."
        />
      ) : (
        <GoalForm accounts={accounts} minDate={iso(tomorrow)} />
      )}
    </AppShell>
  );
}

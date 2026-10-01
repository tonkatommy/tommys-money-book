// A new savings goal.

import { AppShell } from "@/components/app-shell";
import { ButtonLink, Card } from "@/components/ui/primitives";
import { ScreenHead } from "@/components/ui/data";
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
      active="budget"
      book="PERSONAL"
      // Goals are personal only, so the toggle would have nothing to toggle.
      lockBook
      period={period}
      basePath="/goals/new"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="New savings goal"
          right={
            <ButtonLink href="/goals" variant="ghost" size="sm">
              All goals
            </ButtonLink>
          }
        />

        {accounts.length === 0 ? (
          <Card>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              No personal bank account is available to save in. A goal needs a
              bank-fed account in the personal book; run{" "}
              <code>npm run accounts:map</code> if one is still unassigned.
            </p>
          </Card>
        ) : (
          <GoalForm accounts={accounts} minDate={iso(tomorrow)} />
        )}
      </div>
    </AppShell>
  );
}

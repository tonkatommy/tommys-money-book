"use client";

// The goal form and the archive button.
//
// Client components for one reason, `useActionState`, which gives the inline
// error and the pending label — matching `reports/ir3/forms.tsx`. Every
// input is native, so both submit and save with JavaScript disabled.
//
// The account select lists accounts that already have an active goal rather
// than hiding them, marked, so it's clear why picking one will be refused.
// The marking is a hint: the refusal comes from `lib/goals/mutate.ts` and the
// partial unique index, whatever the select offered.

import { useActionState } from "react";
import { Button, Card, FormField } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/form";
import { centsToDollars } from "@/lib/money";
import type { AccountOption } from "@/lib/goals/query";
import {
  archiveGoalAction,
  createGoalAction,
  unarchiveGoalAction,
  updateGoalAction,
  type FormState,
} from "./actions";

export type GoalFormDefaults = {
  id: string;
  name: string;
  accountId: string;
  targetCents: number;
  /** YYYY-MM-DD, or "" for no date. */
  targetDate: string;
  note: string;
};

export function GoalForm({
  accounts,
  goal,
  minDate,
}: {
  accounts: AccountOption[];
  /** Absent for a new goal. */
  goal?: GoalFormDefaults;
  /** Tomorrow in NZ, YYYY-MM-DD: the date picker's floor on create only. */
  minDate?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    goal ? updateGoalAction : createGoalAction,
    undefined,
  );

  // Echoed values first, then the stored goal, so a refused save keeps what
  // was typed. `key={attempt}` forces the remount that makes them take.
  const was = state?.values ?? {};
  const seed = (field: string, fallback = ""): string => was[field] ?? fallback;

  return (
    <Card title={goal ? "Edit goal" : "New goal"}>
      <form
        key={state?.attempt ?? 0}
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}
      >
        {goal && <input type="hidden" name="id" value={goal.id} />}

        <FormField label="Name" htmlFor="name" required>
          <TextField id="name" name="name" defaultValue={seed("name", goal?.name)} placeholder="Japan, March 2027" />
        </FormField>

        <FormField
          label="Saved in"
          htmlFor="accountId"
          required
          hint="The goal's progress is this account's balance, as the bank reports it. One active goal per account, so no balance is counted twice."
        >
          <select
            className="mb-input"
            id="accountId"
            name="accountId"
            defaultValue={seed("accountId", goal?.accountId)}
          >
            <option value="">Choose an account</option>
            {accounts.map((account) => {
              const takenByOther = account.activeGoal && account.activeGoal.id !== goal?.id;
              return (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {takenByOther ? ` (already has "${account.activeGoal!.name}")` : ""}
                </option>
              );
            })}
          </select>
        </FormField>

        <FormField label="Target" htmlFor="target" required>
          <span className="mb-amount">
            <span aria-hidden="true">$</span>
            <input
              id="target"
              name="target"
              inputMode="decimal"
              defaultValue={seed(
                "target",
                goal ? centsToDollars(goal.targetCents).toFixed(2) : "",
              )}
              placeholder="5000"
              style={{ width: 120 }}
            />
          </span>
        </FormField>

        <FormField
          label="Target date"
          htmlFor="targetDate"
          hint="Optional. With a date, the goal shows what has to go in each pay period to make it."
        >
          <input
            className="mb-input"
            id="targetDate"
            type="date"
            name="targetDate"
            min={minDate}
            defaultValue={seed("targetDate", goal?.targetDate)}
          />
        </FormField>

        <FormField label="Note" htmlFor="note" error={state?.error}>
          <textarea
            className="mb-input"
            id="note"
            name="note"
            rows={2}
            defaultValue={seed("note", goal?.note)}
            style={{ resize: "vertical", fontFamily: "var(--font-sans)" }}
          />
        </FormField>

        <div>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : goal ? "Save changes" : "Create goal"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Archive or unarchive. Its own form, so it never posts the edit fields. */
export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    archived ? unarchiveGoalAction : archiveGoalAction,
    undefined,
  );

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name="id" value={id} />
      <div>
        <Button type="submit" variant={archived ? "secondary" : "ghost"} size="sm" disabled={pending}>
          {pending ? "Saving…" : archived ? "Unarchive" : "Archive goal"}
        </Button>
      </div>
      {state?.error && (
        <p role="alert" style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--status-error)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

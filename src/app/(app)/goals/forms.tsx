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

import Link from "next/link";
import { useActionState } from "react";
import { Button, FormField, Icon } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/form";
import { centsToDollars } from "@/lib/money";
import type { AccountOption } from "@/lib/goals/query";
import {
  archiveGoalAction,
  createGoalAction,
  deleteGoalAction,
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
    <form
      key={state?.attempt ?? 0}
      action={formAction}
      className="card pad-l stack"
      style={{ gap: 18, maxWidth: 620 }}
    >
        {goal && <h2 className="t-m">Edit goal</h2>}
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
            className="inp"
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

        <div className="grid cols-2" style={{ gap: 14 }}>
          <FormField label="Target amount" htmlFor="target" required>
            <span className="money-inp">
              <span className="cur" aria-hidden="true">$</span>
              <input
                className="inp"
                id="target"
                name="target"
                inputMode="decimal"
                defaultValue={seed(
                  "target",
                  goal ? centsToDollars(goal.targetCents).toFixed(2) : "",
                )}
                placeholder="5000"
              />
            </span>
          </FormField>

          <FormField
            label={
              <>
                Target date <span className="ink3" style={{ fontWeight: 400 }}>· optional</span>
              </>
            }
            htmlFor="targetDate"
            hint="With a date, the goal shows what has to go in each pay period to make it."
          >
            <input
              className="inp"
              id="targetDate"
              type="date"
              name="targetDate"
              min={minDate}
              defaultValue={seed("targetDate", goal?.targetDate)}
            />
          </FormField>
        </div>

        <FormField label="Note" htmlFor="note" error={state?.error}>
          <textarea
            className="inp"
            id="note"
            name="note"
            rows={2}
            defaultValue={seed("note", goal?.note)}
            style={{ minHeight: 72, padding: "12px 14px", resize: "vertical" }}
          />
        </FormField>

        <div className="row wrap">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : goal ? "Save changes" : "Create goal"}
          </Button>
          {!goal && (
            <Link className="btn quiet" href="/goals">
              Cancel
            </Link>
          )}
        </div>
    </form>
  );
}

/** Archive or unarchive. Its own form, so it never posts the edit fields. */
export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    archived ? unarchiveGoalAction : archiveGoalAction,
    undefined,
  );

  return (
    <form action={formAction} className="stack" style={{ gap: 8, alignItems: "flex-start" }}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant={archived ? "secondary" : "quiet"} disabled={pending}>
        <Icon name="archive" size="sm" />
        {pending ? "Saving…" : archived ? "Restore" : "Archive"}
      </Button>
      {state?.error && (
        <span className="err-t" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

/**
 * Permanent delete, offered only on an archived goal.
 *
 * A checkbox rather than a `confirm()` dialog, so it works with JavaScript
 * disabled. Its `required` stops an unticked submit in the browser; the
 * server checks the value again, since a direct POST skips the browser.
 *
 * `confirmValue` comes from the server page (`DELETE_CONFIRMATION`) rather
 * than being imported here: `lib/goals/mutate.ts` imports Prisma, and this
 * file is bundled for the browser.
 */
export function DeleteGoalForm({
  id,
  name,
  confirmValue,
}: {
  id: string;
  name: string;
  confirmValue: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    deleteGoalAction,
    undefined,
  );

  return (
    <form action={formAction} className="stack" style={{ gap: 12 }}>
      <input type="hidden" name="id" value={id} />
      <label className="chk">
        <input type="checkbox" name="confirm" value={confirmValue} required />
        I understand deleting &ldquo;{name}&rdquo; can&apos;t be undone
      </label>
      <div className="row wrap">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Deleting…" : "Delete goal"}
        </Button>
        <span className="t-xs ink3">Refused unless the box is ticked.</span>
      </div>
      {state?.error && (
        <span className="err-t" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

"use server";

// Server Actions behind the savings goals screens.
//
// Each re-checks the session before touching anything (invariant 6). Create
// and edit are separate actions rather than one action reading a `mode` field,
// because the mode decides whether a past target date is allowed: a field in
// the form is a field a direct POST can set. Each passes its own mode to
// `parseGoalForm`. The account and one-active-goal checks live in
// `lib/goals/mutate.ts`, where the write is.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth/guard";
import { nzToday } from "@/lib/budget/period";
import {
  GOAL_FIELDS,
  archiveGoal,
  createGoal,
  parseGoalForm,
  unarchiveGoal,
  updateGoal,
} from "@/lib/goals/mutate";

export type FormState =
  | {
      ok: false;
      error: string;
      /**
       * What was submitted, echoed back so a refused save doesn't blank the
       * fields that were fine. It has to come from the server: React resets
       * an uncontrolled input once a form action resolves, so `defaultValue`
       * alone loses what was typed. The form pairs it with `attempt` as a
       * `key` — same pattern as `transactions/actions.ts`.
       */
      values?: Record<string, string>;
      /** Increments per submit, so two identical failures still re-seed. */
      attempt?: number;
    }
  | undefined;

const UNAUTHORISED: FormState = {
  ok: false,
  error: "Your session has expired. Reload the page and sign in again.",
};

function submittedValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    GOAL_FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
  );
}

function revalidate(id?: string) {
  revalidatePath("/goals");
  if (id) revalidatePath(`/goals/${id}`);
}

export async function createGoalAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = submittedValues(formData);
  const attempt = (previous?.attempt ?? 0) + 1;
  const reject = (error: string): FormState => ({ ok: false, error, values, attempt });

  if (!(await hasSession())) return UNAUTHORISED;

  const parsed = parseGoalForm(formData, nzToday(), "create");
  if (!parsed.ok) return reject(parsed.error);

  const result = await createGoal(parsed.goal);
  if (!result.ok) return reject(result.error);

  revalidate(result.id);
  redirect(`/goals/${result.id}`);
}

export async function updateGoalAction(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = submittedValues(formData);
  const attempt = (previous?.attempt ?? 0) + 1;
  const reject = (error: string): FormState => ({ ok: false, error, values, attempt });

  if (!(await hasSession())) return UNAUTHORISED;

  // The goal id is a value naming a record, not authority: `updateGoal`
  // re-reads the goal and its account before writing anything.
  const id = String(formData.get("id") ?? "");
  if (!id) return reject("That goal no longer exists.");

  const parsed = parseGoalForm(formData, nzToday(), "edit");
  if (!parsed.ok) return reject(parsed.error);

  const result = await updateGoal(id, parsed.goal);
  if (!result.ok) return reject(result.error);

  revalidate(id);
  return undefined;
}

export async function archiveGoalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const id = String(formData.get("id") ?? "");
  const result = await archiveGoal(id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidate(id);
  return undefined;
}

export async function unarchiveGoalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await hasSession())) return UNAUTHORISED;

  const id = String(formData.get("id") ?? "");
  const result = await unarchiveGoal(id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidate(id);
  return undefined;
}

"use client";

// The three forms on the detail screen.
//
// Three separate `<form>`s rather than one, and that is the design rather than
// an accident: category, notes and the manual-row fields are independent
// decisions with independent Save buttons, so fixing a category can't lose a
// half-typed note, and a rejected amount can't roll back a category that saved
// fine. Each one is a client component only for `useActionState` — every input
// inside is native, so all three still submit with JavaScript disabled.

import { useActionState } from "react";
import { Button, FormField, Icon, Provenance } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/form";
import {
  setCategoryAction,
  setNotesAction,
  updateManualAction,
  type FormState,
} from "../actions";

export function CategoryForm({
  id,
  categoryId,
  categories,
  bookName,
  source,
}: {
  id: string;
  categoryId: string | null;
  categories: { id: string; name: string; kind: string }[];
  /** "Personal" or "Business": the only book whose categories are offered. */
  bookName: string;
  source: "RULE" | "MANUAL" | "TRANSFER" | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    setCategoryAction,
    undefined,
  );

  return (
    <section className="card pad-l" aria-label="Category">
      <form action={formAction} className="stack" style={{ gap: 14 }}>
        <input type="hidden" name="id" value={id} />
        <h2 className="t-m">Category</h2>

        <FormField label={`${bookName} category`} htmlFor="categoryId" error={state?.error}>
          <select
            className="inp"
            id="categoryId"
            name="categoryId"
            defaultValue={categoryId ?? ""}
          >
            <option value="">— no category —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.kind === "EXPENSE" ? "" : ` (${category.kind.toLowerCase()})`}
              </option>
            ))}
          </select>
        </FormField>

        <div className="row wrap">
          <span className="t-s ink2">Right now:</span>
          <Provenance source={source} hasCategory={categoryId !== null} />
        </div>
        <div className="banner info" style={{ padding: "12px 14px" }}>
          <Icon name="pen" />
          <div>
            <p className="bb" style={{ color: "var(--ink)" }}>
              Saving marks this <span className="semi">decided by hand</span>. Hand
              decisions are permanent: no rule or sync will ever change it back.
            </p>
          </div>
        </div>

        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save category"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function NotesForm({ id, notes }: { id: string; notes: string | null }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    setNotesAction,
    undefined,
  );

  return (
    <section className="card pad-l" aria-label="Notes">
      <form action={formAction} className="stack" style={{ gap: 10 }}>
        <input type="hidden" name="id" value={id} />

        <FormField
          label="Notes"
          htmlFor="notes"
          hint="For the things the bank's description doesn't say — which job it was for, who to split it with."
          error={state?.error}
        >
          <textarea
            className="inp"
            id="notes"
            name="notes"
            rows={3}
            defaultValue={notes ?? ""}
            style={{ minHeight: 96, padding: "12px 14px", resize: "vertical" }}
          />
        </FormField>

        <div>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save notes"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * The bank-shaped fields, editable — manual rows only.
 *
 * The page decides whether to render this; `updateManualTransaction` refuses
 * an AKAHU row regardless, because a Server Action is reachable as a direct
 * POST and "the UI never shows the form" is not a guard.
 */
export function ManualFieldsForm({
  id,
  date,
  description,
  payee,
  amountCents,
  notes,
}: {
  id: string;
  date: string;
  description: string;
  payee: string | null;
  amountCents: number;
  notes: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateManualAction,
    undefined,
  );

  // See the note in ../new/form.tsx: React blanks uncontrolled inputs once a
  // form action resolves, so a rejected amount would take the date and
  // description with it. The action echoes what was posted and `attempt`
  // forces the remount that makes the new defaults take.
  const was = state?.values ?? {};
  const seed = (field: string, fallback: string): string => was[field] ?? fallback;

  return (
    <section className="card pad-l" aria-label="What you entered">
      <form
        key={state?.attempt ?? 0}
        action={formAction}
        className="stack"
        style={{ gap: 14 }}
      >
        <div className="row between">
          <h2 className="t-m">What you entered</h2>
          <span className="badge b-cash">Editable</span>
        </div>
        <input type="hidden" name="id" value={id} />
        {/* Notes are edited by their own form; carried here so a save of these
            fields doesn't blank them. */}
        <input type="hidden" name="notes" value={notes ?? ""} />

        <FormField label="Date" htmlFor="date">
          <input className="inp" id="date" type="date" name="date" defaultValue={seed("date", date)} />
        </FormField>

        <FormField label="Description" htmlFor="description" required>
          <TextField id="description" name="description" defaultValue={seed("description", description)} />
        </FormField>

        <FormField label="Payee" htmlFor="payee">
          <TextField id="payee" name="payee" defaultValue={seed("payee", payee ?? "")} />
        </FormField>

        <FormField label="Amount" htmlFor="amount" error={state?.error}>
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="money-inp" style={{ flex: "1 1 140px" }}>
              <span className="cur" aria-hidden="true">$</span>
              <input
                className="inp"
                id="amount"
                name="amount"
                inputMode="decimal"
                defaultValue={seed("amount", (Math.abs(amountCents) / 100).toFixed(2))}
              />
            </span>
            <select
              className="inp"
              name="direction"
              defaultValue={seed("direction", amountCents > 0 ? "in" : "out")}
              aria-label="Money in or out"
              style={{ flex: "0 1 140px" }}
            >
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </select>
          </div>
        </FormField>

        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save entry"}
          </Button>
        </div>
      </form>
    </section>
  );
}

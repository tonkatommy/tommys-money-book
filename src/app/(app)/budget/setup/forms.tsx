"use client";

// The client islands on the setup screen.
//
// They are client components for exactly one reason: `useActionState`, which
// gives the inline error and the pending label. Everything inside them is a
// native input, so every form still submits and saves correctly with
// JavaScript disabled — the island only improves the feedback, the same
// standard the Phase 3a spec set for the transactions bulk action.
//
// Markup follows the canvas's SetBudget artboard: `.txl` sections of `.bl`
// lines, an Everyday/Fixed segmented choice per line, and a sticky save bar.

import { useActionState } from "react";
import { Button, FormField } from "@/components/ui/primitives";
import { AmountField, SwitchField, TextField } from "@/components/ui/form";
import { formatNZD } from "@/lib/money";
import type { CategoryBudgetView } from "@/lib/budget/query";
import {
  pinDetectedBillsAction,
  saveBudgetAction,
  savePayCycleAction,
  type FormState,
} from "../actions";

/**
 * Pin every detected bill at once.
 *
 * Its own `<form>` rather than a button inside the budget form: this posts
 * nothing but the book and the period, and submitting it through the other
 * form would carry every amount field along with it and save them as a side
 * effect of pressing "pin".
 */
export function PinBillsForm({
  book,
  periodStart,
  count,
}: {
  book: string;
  periodStart: string;
  count: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    pinDetectedBillsAction,
    undefined,
  );

  return (
    <form action={formAction} className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="periodStart" value={periodStart} />
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        <span className="i i-check sm" aria-hidden="true" />
        {pending
          ? "Pinning…"
          : `Pin ${count === 1 ? "this detected bill" : `all ${count} detected bills`}`}
      </Button>
      {state?.error && (
        <span className="err-t" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function BudgetForm({
  book,
  periodStart,
  flexible,
  fixed,
  seedFromAverages,
  discardHref,
}: {
  book: string;
  periodStart: string;
  flexible: CategoryBudgetView[];
  fixed: CategoryBudgetView[];
  seedFromAverages: boolean;
  /** This screen without the seed: reloading it drops unsaved edits. */
  discardHref: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveBudgetAction,
    undefined,
  );

  const total = (list: CategoryBudgetView[]) =>
    list.reduce(
      (sum, c) => sum + (seedFromAverages ? c.averageCents : c.standingCents),
      0,
    );

  return (
    <form action={formAction} className="stack" style={{ gap: 20 }}>
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="periodStart" value={periodStart} />

      {state?.error && (
        <FormField error={state.error}>
          <span />
        </FormField>
      )}

      {fixed.length > 0 && (
        <section className="txl" aria-label="Fixed bills">
          <div className="grp-h">
            <span className="sect-t">
              <span className="badge b-fixed">Fixed</span>
              Fixed bills · {fixed.length}
            </span>
            <span className="num t-s">{formatNZD(total(fixed))}</span>
          </div>
          <LineHeader />
          {fixed.map((category) => (
            <BudgetLine key={category.categoryId} category={category} seed={seedFromAverages} />
          ))}
        </section>
      )}

      <section className="txl" aria-label="Everyday categories">
        <div className="grp-h">
          <span className="sect-t">Everyday · {flexible.length}</span>
          <span className="num t-s">{formatNZD(total(flexible))}</span>
        </div>
        <LineHeader />
        {flexible.map((category) => (
          <BudgetLine key={category.categoryId} category={category} seed={seedFromAverages} />
        ))}
        {flexible.length === 0 && fixed.length === 0 && (
          <p className="t-s ink2" style={{ padding: "14px 20px" }}>
            No expense categories have any history in this book yet. Once
            transactions sync and categorise, they appear here.
          </p>
        )}
      </section>

      <div className="savebar">
        <span className="t-s ink2">
          {seedFromAverages
            ? "Filled in from your averages. Nothing is saved until you press Save."
            : "Every line is saved together, from this pay period onwards."}
        </span>
        <span className="row">
          <a className="btn quiet" href={discardHref}>
            Discard
          </a>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save budget"}
          </Button>
        </span>
      </div>
    </form>
  );
}

function LineHeader() {
  return (
    <div className="blh">
      <span>Category</span>
      <span>Type</span>
      <span>Due day</span>
      <span>Amount</span>
    </div>
  );
}

function BudgetLine({
  category,
  seed,
}: {
  category: CategoryBudgetView;
  seed: boolean;
}) {
  const valueCents = seed ? category.averageCents : category.standingCents;
  const id = category.categoryId;

  return (
    <div className="bl">
      <span className="bl-n">
        <span className="semi">{category.name}</span>
        <span className="range">
          {category.unbudgeted && !seed ? "No budget yet · " : ""}3-period avg{" "}
          {formatNZD(category.averageCents)}
        </span>
      </span>

      {/* Two radios rather than a checkbox, so the choice reads as a choice.
          The action only looks for "on", so "off" is the same as unticked. */}
      <span className="bl-t">
        <span className="radio-seg" role="radiogroup" aria-label={`${category.name} type`}>
          <label>
            <input type="radio" name={`fixed:${id}`} value="off" defaultChecked={!category.isFixed} />
            Everyday
          </label>
          <label>
            <input type="radio" name={`fixed:${id}`} value="on" defaultChecked={category.isFixed} />
            Fixed
          </label>
        </span>
      </span>

      <span className="bl-d">
        <label className="vh" htmlFor={`due:${id}`}>
          {category.name} due day
        </label>
        <TextField
          id={`due:${id}`}
          name={`due:${id}`}
          defaultValue={category.dueDay ? String(category.dueDay) : ""}
          placeholder="Fixed only · day"
        />
      </span>

      <span className="bl-a">
        <AmountField
          name={`amount:${id}`}
          valueCents={valueCents}
          ariaLabel={`${category.name} budget`}
          width={86}
        />
        {/* Carries the "amount varies" flag through a save. There is no
            control for it — the detector decides whether a bill's amount moves
            — but the whole form posts every category on every Save, so without
            this the action would read the field as absent and clear a flag
            nobody touched. Rendered only when set, which is exactly what an
            unchecked checkbox would post. */}
        {category.estimated && <input type="hidden" name={`estimated:${id}`} value="on" />}
      </span>
    </div>
  );
}

export function PayCycleForm({
  anchorDay,
  splitFortnightly,
  periodLabel,
  flexBudgetCents,
}: {
  anchorDay: number;
  splitFortnightly: boolean;
  periodLabel: string;
  flexBudgetCents: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePayCycleAction,
    undefined,
  );

  return (
    <section className="card pad-l" aria-label="Pay cycle">
      <form action={formAction} className="stack" style={{ gap: 16 }}>
        <h2 className="t-m">Pay cycle</h2>
        <FormField
          label="Payday · day of month"
          htmlFor="anchorDay"
          hint={`The period runs ${periodLabel}. A month too short for that day falls back to its last day.`}
          error={state?.error}
        >
          <TextField id="anchorDay" name="anchorDay" defaultValue={String(anchorDay)} />
        </FormField>

        <SwitchField
          name="splitFortnightly"
          label="Show half a period at a time"
          defaultChecked={splitFortnightly}
        />
        <p className="hint" style={{ marginTop: -10 }}>
          Display only: your pay stays monthly and no saved budget changes.{" "}
          {splitFortnightly
            ? `Safe to spend shows one fortnight at a time, around ${formatNZD(
                Math.round(flexBudgetCents / 2),
              )} of everyday spending.`
            : "Halves what Safe to spend shows, so a month's money never looks available on the 21st."}
        </p>

        <div>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save pay cycle"}
          </Button>
        </div>
      </form>
    </section>
  );
}

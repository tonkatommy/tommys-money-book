"use client";

// The two client islands on the setup screen.
//
// They are client components for exactly one reason: `useActionState`, which
// gives the inline error and the pending label. Everything inside them is a
// native input, so both forms still submit and save correctly with JavaScript
// disabled — the island only improves the feedback, the same standard the
// Phase 3a spec set for the transactions bulk action.

import { useActionState } from "react";
import { Button, Card, CategoryTag, FormField } from "@/components/ui/primitives";
import { AmountField, SwitchField, TextField } from "@/components/ui/form";
import { formatNZD, formatNZDWhole } from "@/lib/money";
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
 * Its own `<form>` rather than a button inside the budget form above: this
 * posts nothing but the book and the period, and submitting it through the
 * other form would carry every amount field along with it and save them as a
 * side effect of pressing "pin".
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
    <form
      action={formAction}
      style={{
        marginTop: "var(--space-4)",
        paddingTop: "var(--space-4)",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="periodStart" value={periodStart} />

      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending
          ? "Pinning…"
          : `Pin ${count === 1 ? "this bill" : `all ${count} bills`}`}
      </Button>

      <p
        style={{
          margin: "10px 0 0",
          fontSize: "var(--text-xs)",
          color: state?.error ? "var(--status-error)" : "var(--text-muted)",
          lineHeight: 1.6,
        }}
      >
        {state?.error ??
          "Each one is budgeted at the amount it usually costs, and its due day is filled in. Change any of it above afterwards."}
      </p>
    </form>
  );
}

export function BudgetForm({
  book,
  periodStart,
  flexible,
  fixed,
  seedFromAverages,
}: {
  book: string;
  periodStart: string;
  flexible: CategoryBudgetView[];
  fixed: CategoryBudgetView[];
  seedFromAverages: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveBudgetAction,
    undefined,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="periodStart" value={periodStart} />

      <Card
        title="Everyday categories"
        padded={false}
        action={
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save budget"}
          </Button>
        }
      >
        <div className="mb-rows">
          {state?.error && (
            <div style={{ paddingBottom: "var(--space-4)" }}>
              <FormField error={state.error}>
                <span />
              </FormField>
            </div>
          )}

          {flexible.map((category) => (
            <CategoryRow
              key={category.categoryId}
              category={category}
              seedFromAverages={seedFromAverages}
            />
          ))}

          {fixed.length > 0 && (
            <div
              style={{
                paddingTop: "var(--space-5)",
                marginTop: "var(--space-3)",
                borderTop: "1px solid var(--border-default)",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
              }}
            >
              Fixed bills
            </div>
          )}

          {fixed.map((category) => (
            <CategoryRow
              key={category.categoryId}
              category={category}
              seedFromAverages={seedFromAverages}
            />
          ))}

          {flexible.length === 0 && fixed.length === 0 && (
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-muted)",
                paddingTop: "var(--space-4)",
              }}
            >
              No expense categories have any history in this book yet. Once
              transactions sync and categorise, they will appear here.
            </p>
          )}
        </div>
      </Card>
    </form>
  );
}

function CategoryRow({
  category,
  seedFromAverages,
}: {
  category: CategoryBudgetView;
  seedFromAverages: boolean;
}) {
  const valueCents = seedFromAverages
    ? category.averageCents
    : category.standingCents;
  const differenceCents = valueCents - category.averageCents;
  const sameAsUsual = Math.abs(differenceCents) < 100;

  return (
    <div className="mb-row mb-setup-row">
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <CategoryTag name={category.name} book={category.book} />
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            paddingLeft: 2,
          }}
        >
          3-period average{" "}
          <span className="mb-num">{formatNZD(category.averageCents)}</span>
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          className="mb-num"
          style={{
            fontSize: "var(--text-xs)",
            color: sameAsUsual
              ? "var(--text-muted)"
              : differenceCents > 0
                ? "var(--text-tertiary)"
                : "var(--status-warning)",
            minWidth: 96,
            textAlign: "right",
          }}
        >
          {sameAsUsual
            ? "= usual"
            : `${differenceCents > 0 ? "+" : "−"}${formatNZDWhole(
                Math.abs(differenceCents),
              )} vs usual`}
        </span>

        <AmountField
          name={`amount:${category.categoryId}`}
          valueCents={valueCents}
          ariaLabel={`${category.name} budget`}
        />

        <label
          className="mb-switch"
          title="A bill with a due date. Held out of the pace calculation."
        >
          <input
            type="checkbox"
            name={`fixed:${category.categoryId}`}
            defaultChecked={category.isFixed}
          />
          <span className="mb-switch-track" aria-hidden="true" />
          <span className="mb-switch-label">bill</span>
        </label>

        <span style={{ width: 62 }}>
          <TextField
            name={`due:${category.categoryId}`}
            defaultValue={category.dueDay ? String(category.dueDay) : ""}
            placeholder="day"
          />
        </span>
      </div>
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
    <Card title="Pay cycle">
      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <FormField
          label="Payday"
          htmlFor="anchorDay"
          hint={`The period runs ${periodLabel}. A month too short for that day falls back to its last day.`}
          error={state?.error}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 72 }}>
              <TextField
                id="anchorDay"
                name="anchorDay"
                defaultValue={String(anchorDay)}
              />
            </span>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              of the month
            </span>
          </span>
        </FormField>

        <div
          style={{
            paddingTop: "var(--space-4)",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <SwitchField
            name="splitFortnightly"
            label="Show half a period at a time"
            defaultChecked={splitFortnightly}
          />
          <p
            style={{
              margin: "10px 0 0",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}
          >
            {splitFortnightly ? (
              <>
                Your pay stays monthly. Safe-to-spend shows one fortnight at a
                time — around{" "}
                <span className="mb-num">
                  {formatNZDWhole(Math.round(flexBudgetCents / 2))}
                </span>{" "}
                of everyday spending — so a month&rsquo;s money never looks
                available on the 21st.
              </>
            ) : (
              "A monthly lump is hard to pace. This splits the same budget in two so you only ever see half of it at once."
            )}
          </p>
        </div>

        <div>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save pay cycle"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

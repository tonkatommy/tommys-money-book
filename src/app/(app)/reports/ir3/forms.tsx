"use client";

// The adjustments form: the two figures the Akahu feed cannot see.
//
// A client component for exactly one reason — `useActionState`, which gives
// the inline error and the pending label — matching
// `budget/setup/forms.tsx`. Every input is native, so the form still submits
// and saves correctly with JavaScript disabled; the island only improves the
// feedback.
//
// Drawn inside the rental section of the pack (IR3.dc.html), as a sunk panel
// whose border turns serious while either figure is still blank.

import { useActionState } from "react";
import { Button, FormField } from "@/components/ui/primitives";
import { centsToDollars } from "@/lib/money";
import { saveTaxYearAdjustmentAction, type FormState } from "./actions";

/**
 * A dollar field that can be genuinely blank.
 *
 * Unlike `AmountField` (src/components/ui/form.tsx), which always shows a
 * number because every budget line needs one, this field's whole point is
 * that "not entered yet" (null) has to round-trip as an empty input, not a
 * pre-filled $0 a reader could submit by accident and have read as a
 * confirmed zero.
 */
function OptionalAmountField({
  name,
  defaultText,
  missing,
}: {
  name: string;
  defaultText: string;
  missing: boolean;
}) {
  return (
    <span className="money-inp">
      <span className="cur" aria-hidden="true">
        $
      </span>
      <input
        className="inp"
        id={name}
        name={name}
        inputMode="decimal"
        placeholder="not entered"
        defaultValue={defaultText}
        style={missing ? { borderColor: "var(--bad)", borderWidth: 2 } : undefined}
      />
    </span>
  );
}

export function AdjustmentsForm({
  fyLabel,
  rentalManagementFeeCents,
  rentalMortgageInterestCents,
}: {
  fyLabel: string;
  rentalManagementFeeCents: number | null;
  rentalMortgageInterestCents: number | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveTaxYearAdjustmentAction,
    undefined,
  );

  // React resets an uncontrolled input once a form action resolves, so a
  // rejected submit (a typo in one field) would otherwise blank the other,
  // valid one too. The action echoes what was posted in `state.values`;
  // `key={attempt}` on the form below forces the remount that makes the new
  // `defaultValue`s take, and `attempt` incrementing is what makes two
  // identical failures still re-seed — same pattern as
  // `transactions/new/form.tsx`.
  const asText = (cents: number | null): string =>
    cents === null ? "" : centsToDollars(cents).toFixed(2);
  const seed = (field: string, persistedCents: number | null): string =>
    state?.values?.[field] ?? asText(persistedCents);

  const missing =
    rentalManagementFeeCents === null || rentalMortgageInterestCents === null;

  return (
    <form
      key={state?.attempt ?? 0}
      id="bank-cant-see"
      action={formAction}
      className="stack"
      style={{
        gap: 14,
        marginTop: 18,
        padding: 18,
        borderRadius: 12,
        background: "var(--sunk)",
        border: `1px solid ${missing ? "var(--bad-line)" : "var(--line)"}`,
      }}
    >
      <input type="hidden" name="fyLabel" value={fyLabel} />
      <div className="stack" style={{ gap: 2 }}>
        <h3 className="t-m">Figures the bank can&apos;t see · {fyLabel}</h3>
        <span className="t-s ink2">
          Enter them once a year from the Ray White and ASB statements. Leaving
          one blank keeps the warnings honest, rather than the pack quietly
          assuming a number.
        </span>
      </div>
      <div className="grid cols-2" style={{ gap: 14 }}>
        <FormField
          label="Ray White management fee"
          htmlFor="rentalManagementFee"
          hint="Annual total from the manager's statement."
          error={state?.error}
        >
          <OptionalAmountField
            name="rentalManagementFee"
            defaultText={seed("rentalManagementFee", rentalManagementFeeCents)}
            missing={rentalManagementFeeCents === null}
          />
        </FormField>
        <FormField
          label="ASB mortgage interest"
          htmlFor="rentalMortgageInterest"
          hint="Annual total, from the loan statement."
        >
          <OptionalAmountField
            name="rentalMortgageInterest"
            defaultText={seed("rentalMortgageInterest", rentalMortgageInterestCents)}
            missing={rentalMortgageInterestCents === null}
          />
        </FormField>
      </div>
      <div className="row wrap">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save figures"}
        </Button>
      </div>
    </form>
  );
}

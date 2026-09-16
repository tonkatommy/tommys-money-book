"use client";

// The adjustments form: the two figures the Akahu feed cannot see.
//
// A client component for exactly one reason — `useActionState`, which gives
// the inline error and the pending label — matching
// `budget/setup/forms.tsx`. Every input is native, so the form still submits
// and saves correctly with JavaScript disabled; the island only improves the
// feedback.

import { useActionState } from "react";
import { Button, Card, FormField } from "@/components/ui/primitives";
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
  valueCents,
  ariaLabel,
}: {
  name: string;
  valueCents: number | null;
  ariaLabel: string;
}) {
  return (
    <span className="mb-amount">
      <span aria-hidden="true">$</span>
      <input
        name={name}
        inputMode="decimal"
        placeholder="not entered"
        defaultValue={valueCents === null ? "" : centsToDollars(valueCents).toFixed(2)}
        aria-label={ariaLabel}
        style={{ width: 110 }}
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

  return (
    <form action={formAction}>
      <input type="hidden" name="fyLabel" value={fyLabel} />

      <Card
        title={`Adjustments for ${fyLabel}`}
        action={
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        }
      >
        <p
          style={{
            margin: "0 0 var(--space-4)",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            lineHeight: 1.6,
          }}
        >
          Two figures the bank feed cannot see. Enter them once a year from
          the Ray White and ASB statements — leaving either blank is what
          keeps the warnings below honest, rather than the report silently
          assuming a number.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <FormField
            label="Ray White management fee (annual total)"
            htmlFor="rentalManagementFee"
            error={state?.error}
          >
            <OptionalAmountField
              name="rentalManagementFee"
              valueCents={rentalManagementFeeCents}
              ariaLabel="Ray White management fee, annual total"
            />
          </FormField>

          <FormField
            label="ASB mortgage interest (annual total, per loan statement)"
            htmlFor="rentalMortgageInterest"
          >
            <OptionalAmountField
              name="rentalMortgageInterest"
              valueCents={rentalMortgageInterestCents}
              ariaLabel="ASB mortgage interest, annual total"
            />
          </FormField>
        </div>
      </Card>
    </form>
  );
}

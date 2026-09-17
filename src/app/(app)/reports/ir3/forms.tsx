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
  defaultText,
  ariaLabel,
}: {
  name: string;
  defaultText: string;
  ariaLabel: string;
}) {
  return (
    <span className="mb-amount">
      <span aria-hidden="true">$</span>
      <input
        name={name}
        inputMode="decimal"
        placeholder="not entered"
        defaultValue={defaultText}
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

  return (
    <form key={state?.attempt ?? 0} action={formAction}>
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
              defaultText={seed("rentalManagementFee", rentalManagementFeeCents)}
              ariaLabel="Ray White management fee, annual total"
            />
          </FormField>

          <FormField
            label="ASB mortgage interest (annual total, per loan statement)"
            htmlFor="rentalMortgageInterest"
          >
            <OptionalAmountField
              name="rentalMortgageInterest"
              defaultText={seed("rentalMortgageInterest", rentalMortgageInterestCents)}
              ariaLabel="ASB mortgage interest, annual total"
            />
          </FormField>
        </div>
      </Card>
    </form>
  );
}

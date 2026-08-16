"use client";

// The "confirm all in this group" button.
//
// A client component for `useActionState` only — the form is a hidden field
// and a submit, so it works with JavaScript disabled.

import { useActionState } from "react";
import { Button, FormField } from "@/components/ui/primitives";
import { confirmGroupAction, type FormState } from "./actions";

export function ConfirmGroupForm({
  confidence,
  count,
}: {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  count: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    confirmGroupAction,
    undefined,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="confidence" value={confidence} />

      <Button type="submit" variant="primary" size="sm" disabled={pending || count === 0}>
        {pending ? "Pairing…" : `Confirm all ${count}`}
      </Button>

      {state && (
        <div style={{ marginTop: "var(--space-3)" }}>
          {state.ok ? (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--status-ok)" }}>
              Paired {state.wrote}. Both legs of each now net to zero.
            </span>
          ) : (
            <FormField error={state.error}>
              <span />
            </FormField>
          )}
        </div>
      )}
    </form>
  );
}

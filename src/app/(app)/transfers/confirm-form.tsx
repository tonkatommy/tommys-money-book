"use client";

// The "confirm all in this group" button.
//
// A client component for `useActionState` only — the form is a hidden field
// and a submit, so it works with JavaScript disabled. The server re-derives
// which pairs the group holds; the button carries a confidence level, never
// a list of ids (invariant 6).

import { useActionState } from "react";
import { Button } from "@/components/ui/primitives";
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
    <form action={formAction} className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
      <input type="hidden" name="confidence" value={confidence} />

      <Button
        type="submit"
        variant={confidence === "HIGH" ? "primary" : "secondary"}
        size="sm"
        disabled={pending || count === 0}
      >
        <span className="i i-check sm" aria-hidden="true" />
        {pending ? "Pairing…" : `Confirm ${count} ${confidence.toLowerCase()}`}
      </Button>

      {state &&
        (state.ok ? (
          <span className="t-xs" style={{ color: "var(--good)" }}>
            Paired {state.wrote}. Both legs of each now net to zero.
          </span>
        ) : (
          <span className="err-t" role="alert">
            {state.error}
          </span>
        ))}
    </form>
  );
}

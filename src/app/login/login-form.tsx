"use client";

// The one client island on the login page — needed for useActionState's
// pending/error state. The form still works via a plain POST without JS
// (progressive enhancement), same as the budget forms.

import { useActionState } from "react";
import { Button, FormField } from "@/components/ui/primitives";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    login,
    undefined,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}
    >
      <input type="hidden" name="next" value={next} />

      <FormField
        label="Password"
        htmlFor="password"
        error={state?.error}
        hint={
          pending ? "Checking…" : "Set in the server environment as APP_PASSWORD."
        }
      >
        <input
          className="mb-input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          disabled={pending}
          aria-invalid={state?.error ? true : undefined}
          style={{
            minHeight: 44,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-base)",
            letterSpacing: ".12em",
            opacity: pending ? 0.6 : 1,
          }}
        />
      </FormField>

      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        style={{ width: "100%", minHeight: 44 }}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

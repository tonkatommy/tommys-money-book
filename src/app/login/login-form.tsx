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
    <form action={formAction} className="card pad-l stack" style={{ gap: 18 }}>
      <input type="hidden" name="next" value={next} />

      <FormField
        label="Password"
        htmlFor="password"
        error={state?.error}
        hint={pending ? "Checking…" : "There's only one account here, so no username."}
      >
        <input
          className="inp"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          disabled={pending}
          aria-invalid={state?.error ? true : undefined}
          style={{ fontFamily: "var(--fm)", letterSpacing: ".12em", opacity: pending ? 0.6 : 1 }}
        />
      </FormField>

      <Button type="submit" variant="primary" disabled={pending} block>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

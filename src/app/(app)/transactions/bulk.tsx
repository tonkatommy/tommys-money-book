"use client";

// The bulk-categorise bar, and the only client state on the list.
//
// It exists for the label and the disabled state — "Categorise 4 selected"
// and a button that can't be pressed at zero. The form underneath is plain
// checkboxes posting `ids`, so with JavaScript off the whole thing still
// submits and still categorises; the island only stops you pressing a button
// that would have told you off. That is the same progressive-enhancement
// standard the Phase 3a spec set for this screen (§4a).
//
// The count comes from reading the form's own checkboxes on change rather than
// from React state per row. Rows are server-rendered, so mirroring 50
// checkboxes into state would mean 50 controlled inputs and a re-render per
// click, to display one number.

import { useActionState, useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { bulkCategoriseAction, type FormState } from "./actions";

export function BulkForm({
  categories,
  children,
}: {
  categories: { id: string; name: string; kind: string }[];
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    bulkCategoriseAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(0);

  const recount = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    setSelected(
      form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked').length,
    );
  }, []);

  return (
    <form ref={formRef} action={formAction} onChange={recount} className="stack" style={{ gap: 12 }}>
      {children}

      <div className="bulk" role="region" aria-label="Bulk actions">
        <span className="semi">
          {selected === 0 ? "Tick rows to categorise them together" : `${selected} selected`}
        </span>
        <span className="grow" />
        <label>
          <span className="vh">Category to apply</span>
          <select className="inp" name="categoryId" defaultValue="" style={{ width: 220 }}>
            <option value="">— clear the category —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.kind === "EXPENSE" ? "" : ` (${category.kind.toLowerCase()})`}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={pending || selected === 0}>
          {pending
            ? "Applying…"
            : selected === 0
              ? "Categorise selected"
              : `Categorise ${selected} selected`}
        </Button>
        {state?.error && (
          <span className="err-t" role="alert">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

"use client";

// Manual entry — cash the bank never sees.
//
// The $3,870 of ATM withdrawals in the baseline is the reason this exists:
// the feed can see the money leave the account and has no idea where it went,
// so the only way that spending ever reaches a category is somebody typing it.
//
// The category list is not filtered client-side when the book radio changes.
// It carries both books' categories with the book in each option's label, and
// the server re-checks that the chosen category matches the chosen book
// (spec §4c) and rejects a mismatch. Filtering in the browser would be a
// nicer list and exactly as unsafe, since a direct POST skips the browser.

import { useActionState } from "react";
import { Button, Card, FormField } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/form";
import { createManualAction, type FormState } from "../actions";

export function ManualEntryForm({
  book,
  today,
  categories,
}: {
  book: "PERSONAL" | "BUSINESS";
  today: string;
  categories: { id: string; name: string; book: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createManualAction,
    undefined,
  );

  // React resets an uncontrolled input once a form action resolves, so a
  // rejected submit would otherwise blank every field including the five that
  // were fine. The action echoes what was posted; `key` forces the remount
  // that makes the new `defaultValue`s take, and `attempt` is what makes two
  // identical failures still re-seed rather than the key staying equal.
  const was = state?.values ?? {};
  const seed = (field: string, fallback = ""): string => was[field] ?? fallback;

  return (
    <Card title="New cash entry">
      <form
        key={state?.attempt ?? 0}
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}
      >
        <FormField label="Which book" hint="Decides which Cash account it lands in, and which categories it may use.">
          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}>
              <input type="radio" name="book" value="PERSONAL" defaultChecked={seed("book", book) !== "BUSINESS"} />
              Personal
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}>
              <input type="radio" name="book" value="BUSINESS" defaultChecked={seed("book", book) === "BUSINESS"} />
              Business
            </label>
          </div>
        </FormField>

        <FormField label="Date" htmlFor="date">
          <input className="mb-input" id="date" type="date" name="date" defaultValue={seed("date", today)} />
        </FormField>

        <FormField
          label="Description"
          htmlFor="description"
          required
          hint="What it was. This is the only thing you will have to recognise it by later."
        >
          <TextField id="description" name="description" defaultValue={seed("description")} placeholder="Firewood from the roadside stall" />
        </FormField>

        <FormField label="Payee" htmlFor="payee">
          <TextField id="payee" name="payee" defaultValue={seed("payee")} placeholder="Optional" />
        </FormField>

        <FormField label="Amount" htmlFor="amount" error={state?.error}>
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 140px" }}>
              <TextField id="amount" name="amount" defaultValue={seed("amount")} placeholder="40.00" />
            </span>
            <select
              className="mb-input"
              name="direction"
              defaultValue={seed("direction", "out")}
              aria-label="Money in or out"
              style={{ flex: "0 1 140px" }}
            >
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </select>
          </div>
        </FormField>

        <FormField label="Category" htmlFor="categoryId">
          <select className="mb-input" id="categoryId" name="categoryId" defaultValue={seed("categoryId")}>
            <option value="">— decide later —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.book === "BUSINESS" ? "business" : "personal"})
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Notes" htmlFor="notes">
          <textarea
            className="mb-input"
            id="notes"
            name="notes"
            rows={2}
            defaultValue={seed("notes")}
            style={{ resize: "vertical", fontFamily: "var(--font-sans)" }}
          />
        </FormField>

        <div>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save entry"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

"use client";

// Manual entry — cash the bank never sees.
//
// The $3,870 of ATM withdrawals in the baseline is the reason this exists:
// the feed can see the money leave the account and has no idea where it went,
// so the only way that spending ever reaches a category is somebody typing it.
//
// The category list is not filtered client-side when the book choice changes.
// It carries both books' categories with the book in each option's label, and
// the server re-checks that the chosen category matches the chosen book
// (spec §4c) and rejects a mismatch. Filtering in the browser would be a
// nicer list and exactly as unsafe, since a direct POST skips the browser.
//
// Book and direction are radios dressed as segmented controls (design.css
// `.radio-seg`), so the choice is visible and the form posts with no script.

import Link from "next/link";
import { useActionState } from "react";
import { Button, FormField, Icon } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/form";
import { createManualAction, type FormState } from "../actions";

export function ManualEntryForm({
  book,
  today,
  categories,
  cancelHref,
}: {
  book: "PERSONAL" | "BUSINESS";
  today: string;
  categories: { id: string; name: string; book: string }[];
  cancelHref: string;
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
  const chosenBook = seed("book", book);
  const direction = seed("direction", "out");

  return (
    <form
      key={state?.attempt ?? 0}
      action={formAction}
      className="card pad-l stack"
      style={{ gap: 18 }}
    >
      <div className="field">
        <span className="flabel" id="book-label">
          Book
        </span>
        <div className="radio-seg" role="radiogroup" aria-labelledby="book-label" style={{ display: "flex" }}>
          <label style={{ flex: 1, justifyContent: "center" }}>
            <input type="radio" name="book" value="PERSONAL" defaultChecked={chosenBook !== "BUSINESS"} />
            <span className="bk p" aria-hidden="true" />
            Personal
          </label>
          <label style={{ flex: 1, justifyContent: "center" }}>
            <input type="radio" name="book" value="BUSINESS" defaultChecked={chosenBook === "BUSINESS"} />
            <span className="bk b" aria-hidden="true" />
            Business · Tommy Tinkers
          </label>
        </div>
        <span className="hint">Decides which Cash account it lands in, and which categories it may use.</span>
      </div>

      <div className="grid cols-2" style={{ gap: 14 }}>
        <FormField label="Date" htmlFor="date">
          <input className="inp" id="date" type="date" name="date" defaultValue={seed("date", today)} />
        </FormField>
        <div className="field">
          <span className="flabel" id="dir-label">
            In or out
          </span>
          <div className="radio-seg" role="radiogroup" aria-labelledby="dir-label" style={{ display: "flex" }}>
            <label style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name="direction" value="out" defaultChecked={direction !== "in"} />
              <Icon name="out" size="sm" />
              Out
            </label>
            <label style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name="direction" value="in" defaultChecked={direction === "in"} />
              <Icon name="in" size="sm" />
              In
            </label>
          </div>
        </div>
      </div>

      <FormField
        label="Description"
        htmlFor="description"
        required
        hint="What it was. This is the only thing you'll have to recognise it by later."
      >
        <TextField
          id="description"
          name="description"
          defaultValue={seed("description")}
          placeholder="Firewood from the roadside stall"
        />
      </FormField>

      <FormField label="Payee" htmlFor="payee">
        <TextField id="payee" name="payee" defaultValue={seed("payee")} placeholder="Optional" />
      </FormField>

      <FormField
        label="Amount"
        htmlFor="amount"
        error={state?.error}
        hint={'Always positive. "In" or "Out" sets the direction.'}
      >
        <span className="money-inp">
          <span className="cur" aria-hidden="true">
            $
          </span>
          <input
            className="inp"
            id="amount"
            name="amount"
            inputMode="decimal"
            defaultValue={seed("amount")}
            placeholder="40.00"
          />
        </span>
      </FormField>

      <FormField
        label={
          <>
            Category <span className="ink3" style={{ fontWeight: 400 }}>· optional</span>
          </>
        }
        htmlFor="categoryId"
        hint="Must belong to the book chosen above. A mismatch is refused, not guessed."
      >
        <select className="inp" id="categoryId" name="categoryId" defaultValue={seed("categoryId")}>
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
          className="inp"
          id="notes"
          name="notes"
          rows={2}
          defaultValue={seed("notes")}
          style={{ minHeight: 72, padding: "12px 14px", resize: "vertical" }}
        />
      </FormField>

      <div className="row wrap">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Add entry"}
        </Button>
        <Link className="btn quiet" href={cancelHref}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

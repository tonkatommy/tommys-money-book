// Form controls.
//
// The design system's originals hold their state in React. These are rebuilt
// as native inputs styled entirely by CSS (`:checked`, `:focus-within` — see
// globals.css), which is what lets the budget screens submit a whole form of
// amounts, toggles and choices with no client JavaScript at all. Every one of
// them still works with scripting disabled, which is the standard the Phase 3a
// spec set for the transactions bulk action.

import type { ReactNode } from "react";
import { centsToDollars } from "@/lib/money";

/** Text input for search and free-text fields. */
export function TextField({
  name,
  id,
  type = "text",
  placeholder,
  defaultValue,
  required = false,
  autoFocus = false,
  invalid = false,
}: {
  name: string;
  id?: string;
  type?: "text" | "password" | "date" | "search";
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      className="mb-input"
      id={id}
      name={name}
      type={type}
      placeholder={placeholder}
      defaultValue={defaultValue}
      required={required}
      autoFocus={autoFocus}
      aria-invalid={invalid || undefined}
    />
  );
}

/**
 * A $-prefixed amount field. Displays and submits dollars; the Server Action
 * parses back to integer cents.
 *
 * Dollars on the wire rather than cents because the value is typed by a human
 * — a field that shows 72000 and means $720 is a data-entry trap. The
 * conversion is one function (`parseDollarsToCents`) on the server, which is
 * also the only place it can be validated.
 */
export function AmountField({
  name,
  id,
  valueCents,
  width = 78,
  dp = 0,
  invalid = false,
  ariaLabel,
}: {
  name: string;
  id?: string;
  valueCents: number;
  width?: number;
  dp?: 0 | 2;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const dollars = centsToDollars(valueCents);
  const shown = dp === 2 ? dollars.toFixed(2) : String(Math.round(dollars));

  return (
    <span className="mb-amount" data-invalid={invalid || undefined}>
      <span aria-hidden="true">$</span>
      <input
        id={id}
        name={name}
        inputMode="decimal"
        defaultValue={shown}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        style={{ width }}
      />
    </span>
  );
}

/**
 * A row of mutually exclusive pills backed by real radio inputs.
 *
 * Used for the month-end keep/carry/match decision. Native radios mean the
 * whole review screen is one form with one submit — no per-row round trip, no
 * client state, and the browser handles keyboard navigation for free.
 */
export function ChoiceGroup({
  name,
  options,
  value,
  label,
}: {
  name: string;
  options: { value: string; label: ReactNode; hint?: string }[];
  value?: string | null;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mb-choices">
      {options.map((option) => (
        <label key={option.value} className="mb-choice" title={option.hint}>
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={value === option.value}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Toggle switch. A checkbox underneath, so it posts with the form. */
export function SwitchField({
  name,
  label,
  defaultChecked = false,
  value = "on",
}: {
  name: string;
  label?: ReactNode;
  defaultChecked?: boolean;
  value?: string;
}) {
  return (
    <label className="mb-switch">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
      />
      <span className="mb-switch-track" aria-hidden="true" />
      {label && <span className="mb-switch-label">{label}</span>}
    </label>
  );
}

/** Native select, styled to match. */
export function SelectField({
  name,
  id,
  options,
  value,
  placeholder,
  ariaLabel,
}: {
  name: string;
  id?: string;
  options: { value: string; label: string }[];
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      className="mb-select"
      id={id}
      name={name}
      defaultValue={value ?? (placeholder ? "" : undefined)}
      aria-label={ariaLabel}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

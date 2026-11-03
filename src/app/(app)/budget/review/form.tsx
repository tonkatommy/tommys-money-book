"use client";

// The month-end decision form.
//
// Native radios, so the whole review is one form with one Apply — no per-row
// round trip and no client state to lose. The island exists for the inline
// error and the pending label only; with JavaScript off, every choice still
// posts and applies.
//
// Each option is labelled with the budget it would give this period, so the
// consequence of a choice is readable before it's made, with no script
// recalculating a column as you click.

import { useActionState } from "react";
import { Button, FormField } from "@/components/ui/primitives";
import { ChoiceGroup } from "@/components/ui/form";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { allowanceCents, monthEndAmounts } from "@/lib/budget/totals";
import type { ReviewLine } from "@/lib/budget/query";
import { applyMonthEndAction, type FormState } from "../actions";

export function ReviewForm({
  book,
  periodStart,
  lines,
  applyLabel,
  trendsHref,
}: {
  book: string;
  periodStart: string;
  lines: ReviewLine[];
  /** "Apply to 20/10 – 19/11". */
  applyLabel: string;
  trendsHref: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    applyMonthEndAction,
    undefined,
  );

  return (
    <form action={formAction} className="stack" style={{ gap: 16 }}>
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="periodStart" value={periodStart} />

      {state?.error && (
        <FormField error={state.error}>
          <span />
        </FormField>
      )}

      <section className="txl" aria-label="Decisions">
        <div className="blh rv">
          <span>Category · budget vs spent</span>
          <span>Decision · budget it gives this period</span>
          <span style={{ textAlign: "right" }}>Difference</span>
        </div>
        {lines.map((line) => {
          const differenceCents = line.budgetCents - line.spentCents;
          const amounts = monthEndAmounts(line.budgetCents, line.spentCents);
          const carried = allowanceCents(
            amounts.carry.amountCents,
            amounts.carry.carryoverCents,
          );

          return (
            <div key={line.categoryId} className="bl rv">
              <input type="hidden" name={`budget:${line.categoryId}`} value={line.budgetCents} />
              <input type="hidden" name={`spent:${line.categoryId}`} value={line.spentCents} />

              <span className="bl-n">
                <span className="semi">{line.name}</span>
                <span className="t-xs ink2">
                  <span className="num">{formatNZDWhole(line.budgetCents)}</span> budget ·{" "}
                  <span className="num">{formatNZD(line.spentCents)}</span> spent
                  {line.budgetedThisPeriod ? " · already set this period" : ""}
                </span>
              </span>

              <span className="bl-t">
                <ChoiceGroup
                  name={`choice:${line.categoryId}`}
                  label={`What to do with ${line.name}`}
                  options={[
                    {
                      value: "keep",
                      label: `Keep ${formatNZDWhole(amounts.keep.amountCents)}`,
                      hint: "The same budget again.",
                    },
                    {
                      value: "carry",
                      label: `${differenceCents >= 0 ? "Carry" : "Repay"} → ${formatNZDWhole(carried)}`,
                      hint:
                        differenceCents >= 0
                          ? `Adds the ${formatNZD(differenceCents)} underspend, this period only.`
                          : `Pays back the ${formatNZD(-differenceCents)} overspend, this period only.`,
                    },
                    {
                      value: "match",
                      label: `Match ${formatNZDWhole(amounts.match.amountCents)}`,
                      hint: "Set the budget to what you actually spent, from now on.",
                    },
                  ]}
                />
              </span>

              <span className="bl-a" style={{ textAlign: "right" }}>
                <span
                  className={`delta ${differenceCents >= 0 ? "ahead" : "behind"}`}
                  style={{ fontSize: 13, padding: "3px 9px" }}
                >
                  {differenceCents === 0
                    ? "On budget"
                    : `${formatNZD(Math.abs(differenceCents))} ${differenceCents > 0 ? "under" : "over"}`}
                </span>
              </span>
            </div>
          );
        })}
      </section>

      <div className="savebar">
        <span className="t-s ink2">
          A category left undecided keeps its budget as it is.
        </span>
        <span className="row">
          <a className="btn quiet" href={trendsHref}>
            See trends first
          </a>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Applying…" : applyLabel}
          </Button>
        </span>
      </div>
    </form>
  );
}

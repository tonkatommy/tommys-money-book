"use client";

// The month-end decision form.
//
// Native radios, so the whole review is one form with one Apply — no per-row
// round trip and no client state to lose. The island exists for the inline
// error and the pending label only; with JavaScript off, every choice still
// posts and applies.

import { useActionState } from "react";
import { Badge, Button, Card, CategoryTag, FormField } from "@/components/ui/primitives";
import { ChoiceGroup } from "@/components/ui/form";
import { PaceBar } from "@/components/ui/data";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { monthEndAmounts } from "@/lib/budget/totals";
import type { ReviewLine } from "@/lib/budget/query";
import { applyMonthEndAction, type FormState } from "../actions";

export function ReviewForm({
  book,
  periodStart,
  lines,
}: {
  book: string;
  periodStart: string;
  lines: ReviewLine[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    applyMonthEndAction,
    undefined,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="book" value={book} />
      <input type="hidden" name="periodStart" value={periodStart} />

      <Card
        title="One decision each"
        padded={false}
        action={
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Applying…" : "Apply to this period"}
          </Button>
        }
      >
        <div className="mb-rows">
          {state?.error && (
            <div style={{ paddingBottom: "var(--space-4)" }}>
              <FormField error={state.error}>
                <span />
              </FormField>
            </div>
          )}

          {lines.map((line) => {
            const differenceCents = line.budgetCents - line.spentCents;
            const amounts = monthEndAmounts(line.budgetCents, line.spentCents);

            return (
              <div key={line.categoryId} className="mb-row mb-decide">
                <input
                  type="hidden"
                  name={`budget:${line.categoryId}`}
                  value={line.budgetCents}
                />
                <input
                  type="hidden"
                  name={`spent:${line.categoryId}`}
                  value={line.spentCents}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <CategoryTag name={line.name} book={line.book} />
                    <span
                      className="mb-num"
                      style={{
                        fontSize: "var(--text-xs)",
                        color:
                          differenceCents >= 0
                            ? "var(--status-ok)"
                            : "var(--status-error)",
                      }}
                    >
                      {formatNZD(Math.abs(differenceCents))}{" "}
                      {differenceCents >= 0 ? "under" : "over"}
                    </span>
                    <span
                      className="mb-num"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {formatNZD(line.spentCents)} of{" "}
                      {formatNZDWhole(line.budgetCents)}
                    </span>
                    {line.budgetedThisPeriod && <Badge tone="ok">budgeted</Badge>}
                  </div>

                  <div style={{ maxWidth: 340 }}>
                    <PaceBar
                      spentCents={line.spentCents}
                      budgetCents={line.budgetCents}
                    />
                  </div>
                </div>

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
                      label:
                        differenceCents >= 0
                          ? `Carry +${formatNZDWhole(differenceCents)}`
                          : `Repay ${formatNZDWhole(Math.abs(differenceCents))}`,
                      hint: "Same budget, with the difference rolled into this period's allowance.",
                    },
                    {
                      value: "match",
                      label: `Match ${formatNZDWhole(amounts.match.amountCents)}`,
                      hint: "Set the budget to what you actually spend.",
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </form>
  );
}

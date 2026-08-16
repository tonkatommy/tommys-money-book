// /budget before a budget exists.
//
// Three periods of transactions have already synced and been categorised, so
// this screen spends that history rather than announcing an empty state. The
// difference matters: "no budget yet" is a dead end, whereas "here is what
// you actually spend, shall we start there?" is one click from done.

import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Card,
  CategoryTag,
} from "@/components/ui/primitives";
import { KV, PaceBar, ScreenHead } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import type { BudgetView } from "@/lib/budget/query";
import { SUGGESTION_PERIODS } from "@/lib/budget/query";

export function FirstRun({ view }: { view: BudgetView }) {
  const { book, period } = view;

  // Everything with a history worth budgeting. A category nobody has spent
  // anything in over three periods does not need a line.
  const suggested = view.allCategories
    .filter((category) => category.averageCents > 0)
    .sort((a, b) => b.averageCents - a.averageCents);

  const suggestedTotal = suggested.reduce((sum, c) => sum + c.averageCents, 0);
  const shown = suggested.slice(0, 7);
  const rest = suggested.slice(7);
  const restTotal = rest.reduce((sum, c) => sum + c.averageCents, 0);
  // The average, not this period's income so far. A full period's budget
  // compared against a part-elapsed period's income says you are hundreds of
  // percent overcommitted — arithmetic rather than information.
  const spareCents = view.averageIncomeCents - suggestedTotal;

  if (suggested.length === 0) {
    return (
      <Card>
        <ScreenHead
          title="Not enough history to suggest a budget yet"
          sub="Once a few periods of transactions have synced and been categorised, this screen will suggest a budget from what you actually spend. You can still set one by hand now."
        />
        <ButtonLink href={withBook("/budget/setup", book)} variant="primary">
          Set a budget by hand
        </ButtonLink>
      </Card>
    );
  }

  return (
    <div className="mb-stack">
      <ScreenHead
        title="You have enough history to budget"
        sub={`${SUGGESTION_PERIODS} pay periods have synced and been categorised. Every figure below is your own average — nothing here is a template.`}
        right={<Badge tone="ok">{suggested.length} categories with history</Badge>}
      />

      <div className="mb-hero">
        <div className="mb-hero-left">
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            Suggested budget for a period
          </div>
          <div
            className="mb-figure"
            style={{ margin: "6px 0 8px", color: "var(--text-primary)" }}
          >
            {formatNZDWhole(suggestedTotal)}
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            The mean of your last {SUGGESTION_PERIODS} periods, per category — not
            the highest, and not just the most recent.
          </div>

          <div
            style={{
              marginTop: "var(--space-5)",
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <KV
              label="Money in each period"
              value={formatNZD(view.averageIncomeCents)}
              tone="var(--money-in)"
            />
            <KV
              label={spareCents >= 0 ? "Would be left over" : "Would be short by"}
              value={formatNZD(Math.abs(spareCents))}
              tone={
                spareCents >= 0 ? "var(--status-ok)" : "var(--status-error)"
              }
            />
          </div>

          <div
            style={{
              marginTop: "var(--space-5)",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <ButtonLink
              href={withBook("/budget/setup?seed=averages", book)}
              variant="primary"
            >
              Build it from these averages
            </ButtonLink>
            <ButtonLink href={withBook("/budget/setup", book)} variant="ghost">
              Start from zero
            </ButtonLink>
          </div>
        </div>

        <div className="mb-hero-right">
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              marginBottom: "var(--space-4)",
            }}
          >
            Where the money goes
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            {shown.slice(0, 5).map((category) => (
              <div key={category.categoryId}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                    marginBottom: 6,
                  }}
                >
                  <span
                    className="mb-truncate"
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {category.name}
                  </span>
                  <span className="mb-num" style={{ fontSize: "var(--text-sm)" }}>
                    {formatNZDWhole(category.averageCents)}
                  </span>
                </div>
                <PaceBar
                  spentCents={category.averageCents}
                  budgetCents={shown[0].averageCents}
                  tone="accent"
                />
              </div>
            ))}
          </div>

          <p
            style={{
              margin: "var(--space-5) 0 0",
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border-subtle)",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}
          >
            You can change every line before saving, and change any of them again
            at month end.
          </p>
        </div>
      </div>

      <div className="mb-grid mb-grid-main">
        <Card
          title="What we would suggest"
          padded={false}
          action={
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              largest first
            </span>
          }
        >
          <div className="mb-rows">
            {shown.map((category) => (
              <div
                key={category.categoryId}
                className="mb-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 0",
                  flexWrap: "wrap",
                }}
              >
                <CategoryTag name={category.name} book={category.book} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span className="mb-num" style={{ fontSize: "var(--text-sm)" }}>
                    {formatNZDWhole(category.averageCents)}
                  </span>
                  <span
                    style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
                  >
                    a period
                  </span>
                </div>
              </div>
            ))}

            {rest.length > 0 && (
              <div
                style={{
                  paddingTop: "var(--space-4)",
                  marginTop: "var(--space-2)",
                  borderTop: "1px solid var(--border-subtle)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                and {rest.length} smaller categories,{" "}
                {formatNZDWhole(restTotal)} between them.
              </div>
            )}
          </div>
        </Card>

        <Card title="What happens next">
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              lineHeight: 1.7,
            }}
          >
            <li>Every category starts at its average — adjust anything.</li>
            <li>
              The period runs {period.label}, on your payday. Change that on{" "}
              <Link href={withBook("/budget/setup", book)}>Set budget</Link>.
            </li>
            <li>
              Repeating payments become fixed bills, so they never count as
              everyday spending.
            </li>
            <li>At month end you decide each category once: keep, carry, or match.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}

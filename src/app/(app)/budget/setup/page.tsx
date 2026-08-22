// Set the budget.
//
// One form, one Save. Amounts are native inputs, the fixed-bill pins are
// checkboxes and the pay cycle is its own small form — so the whole screen
// submits without a line of client JavaScript. The only interactive island is
// the submit button's pending state.

import { AppShell } from "@/components/app-shell";
import {
  Badge,
  Card,
  CategoryTag,
  StatusDot,
} from "@/components/ui/primitives";
import { Figure, PaceBar, ScreenHead } from "@/components/ui/data";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { shortDate } from "@/lib/budget/period";
import {
  getBudgetView,
  parseBook,
  resolvePeriod,
  suggestFixedBills,
} from "@/lib/budget/query";
import { BudgetForm, PayCycleForm, PinBillsForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; period?: string; seed?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod(params.period);

  const [view, suggestions] = await Promise.all([
    getBudgetView(book, period, settings),
    suggestFixedBills(book, period, settings),
  ]);

  // Arriving from the first-run screen's "build it from these averages": every
  // field starts at the category's three-period average instead of its
  // (non-existent) saved budget. Nothing is written until Save.
  const seedFromAverages = params.seed === "averages";

  const categories = view.allCategories.filter(
    (category) =>
      category.standingCents > 0 ||
      category.spentCents !== 0 ||
      category.averageCents > 0,
  );

  const flexible = categories.filter((c) => !c.isFixed);
  const fixed = categories.filter((c) => c.isFixed);

  const plannedCents = categories.reduce(
    (sum, category) =>
      sum + (seedFromAverages ? category.averageCents : category.standingCents),
    0,
  );
  const spareCents = view.averageIncomeCents - plannedCents;

  // Detected bills the reader hasn't pinned yet — the "we found these" list.
  const unpinned = [...suggestions.values()].filter((suggestion) => {
    const category = categories.find((c) => c.categoryId === suggestion.categoryId);
    return category && !category.isFixed;
  });

  return (
    <AppShell
      active="setup"
      book={book}
      period={period}
      basePath="/budget/setup"
      preserveQuery={params.period ? `period=${params.period}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Set the budget"
          sub="Suggestions are your average of the last three pay periods. Change anything — nothing is locked, and every figure can be changed again at month end."
        />

        <Card>
          <div className="mb-grid mb-grid-3" style={{ gap: "var(--space-5)" }}>
            <Figure
              label="Money in each period"
              value={formatNZD(view.averageIncomeCents)}
              tone="var(--money-in)"
            />
            <Figure label="Budgeted out" value={formatNZDWhole(plannedCents)} />
            <Figure
              label={spareCents >= 0 ? "Left over to save" : "Short by"}
              value={formatNZD(Math.abs(spareCents))}
              tone={spareCents >= 0 ? "var(--status-ok)" : "var(--status-error)"}
            />
          </div>

          {view.averageIncomeCents > 0 && (
            <div style={{ marginTop: "var(--space-5)" }}>
              <PaceBar
                spentCents={plannedCents}
                budgetCents={view.averageIncomeCents}
                tone={plannedCents > view.averageIncomeCents ? "error" : "accent"}
              />
              <div
                style={{
                  marginTop: 6,
                  fontSize: "var(--text-xs)",
                  color: "var(--text-muted)",
                }}
              >
                {Math.round((plannedCents / view.averageIncomeCents) * 100)}% of your
                income is spoken for.
              </div>
            </div>
          )}
        </Card>

        <BudgetForm
          book={book}
          periodStart={period.start.toISOString().slice(0, 10)}
          flexible={flexible}
          fixed={fixed}
          seedFromAverages={seedFromAverages}
        />

        <div className="mb-grid mb-grid-setup">
          <Card
            title="Bills we found"
            action={
              <Badge tone={unpinned.length ? "warning" : "ok"}>
                {fixed.length} pinned
              </Badge>
            }
          >
            <p
              style={{
                margin: "0 0 var(--space-3)",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                lineHeight: 1.6,
              }}
            >
              Detected from repeating payments in your feed, matched on the
              payee and how regularly it lands. Pinned bills are held aside from
              &ldquo;safe to spend&rdquo; and left out of the pace calculation —
              pacing a mortgage evenly across a month is a meaningless number.
            </p>

            {unpinned.map((suggestion) => {
              const category = categories.find(
                (c) => c.categoryId === suggestion.categoryId,
              );
              if (!category) return null;

              return (
                <div
                  key={suggestion.categoryId}
                  className="mb-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 0",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="mb-truncate"
                      style={{
                        fontSize: "var(--text-sm)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {category.name}
                    </div>
                    <div
                      className="mb-num"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {formatNZD(suggestion.amountCents)} · around the{" "}
                      {suggestion.dueDay}
                      {suggestion.estimated ? " · amount varies" : ""} ·{" "}
                      {suggestion.occurrences} times
                    </div>
                  </div>
                  <span
                    style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}
                  >
                    tick &ldquo;bill&rdquo; above to pin
                  </span>
                </div>
              );
            })}

            {unpinned.length > 0 && (
              <PinBillsForm
                book={book}
                periodStart={period.start.toISOString().slice(0, 10)}
                count={unpinned.length}
              />
            )}

            {unpinned.length === 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "var(--text-sm)",
                  color: "var(--text-muted)",
                }}
              >
                <StatusDot tone="ok" />
                Every repeating payment we can see is already pinned.
              </div>
            )}

            {fixed.length > 0 && (
              <div
                style={{
                  marginTop: "var(--space-4)",
                  paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {fixed.map((category) => (
                  <div
                    key={category.categoryId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <CategoryTag name={category.name} book={category.book} />
                    <span
                      className="mb-num"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-tertiary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {category.dueDate ? shortDate(category.dueDate) : "no date"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <PayCycleForm
            anchorDay={settings.anchorDay}
            splitFortnightly={settings.splitFortnightly}
            periodLabel={period.label}
            flexBudgetCents={view.totals.flexBudgetCents}
          />
        </div>
      </div>
    </AppShell>
  );
}

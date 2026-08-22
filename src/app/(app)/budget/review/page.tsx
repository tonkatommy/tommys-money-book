// Month end: what actually happened last period, and one decision per
// category before the next one runs away.
//
// The three options are deliberately the whole vocabulary. A budget review
// that offers free-text adjustment becomes an accounting exercise nobody
// finishes; keep / carry / match is a decision you can make in two seconds per
// category, and all three are defensible answers.

import { AppShell } from "@/components/app-shell";
import { Alert, Card } from "@/components/ui/primitives";
import { Figure, ScreenHead } from "@/components/ui/data";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { getReviewView, parseBook, resolvePeriod } from "@/lib/budget/query";
import { ReviewForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; period?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod(params.period);
  const { previous, lines, previousWasBudgeted } = await getReviewView(
    book,
    period,
    settings,
  );

  const budgetCents = lines.reduce((sum, line) => sum + line.budgetCents, 0);
  const spentCents = lines.reduce((sum, line) => sum + line.spentCents, 0);
  const overspent = lines.filter((line) => line.spentCents > line.budgetCents);
  const differenceCents = budgetCents - spentCents;

  // Full names, not the prototype's `split(" — ")[0]`. The real category list
  // has four Insurance categories and two BNPL ones, and shortening turns the
  // sentence into "Insurance, Insurance, Insurance, Insurance".
  const OVERSPENT_NAMED = 5;
  const namedOverspends = overspent.slice(0, OVERSPENT_NAMED);
  const unnamedOverspends = overspent.length - namedOverspends.length;

  return (
    <AppShell
      active="review"
      book={book}
      period={period}
      basePath="/budget/review"
      preserveQuery={params.period ? `period=${params.period}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Month-end review"
          sub={`${previous.label} has closed. Decide each category once and the choice applies to the running ${period.label} period.`}
        />

        {lines.length === 0 ? (
          <Card>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              Nothing was budgeted or spent in {previous.label}, so there is
              nothing to review.
            </p>
          </Card>
        ) : !previousWasBudgeted ? (
          // Every category would read as "over" against a budget of zero.
          // That is arithmetically true and tells the reader nothing, so the
          // screen says what actually happened instead.
          <Card>
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                color: "var(--text-tertiary)",
              }}
            >
              {previous.label} had no budget set, so there is nothing to compare
              against yet — you spent{" "}
              <span className="mb-num" style={{ color: "var(--text-primary)" }}>
                {formatNZD(spentCents)}
              </span>{" "}
              across {lines.length} categories. This screen becomes useful at the
              end of {period.label}, once a full period has run against the
              budget you have now set.
            </p>
          </Card>
        ) : (
          <>
            {overspent.length > 0 && (
              <Alert level="warning">
                {overspent.length}{" "}
                {overspent.length === 1 ? "category" : "categories"} finished
                over: {namedOverspends.map((line) => line.name).join(", ")}
                {unnamedOverspends > 0
                  ? `, and ${unnamedOverspends} more`
                  : ""}
                . Everything else came in under.
              </Alert>
            )}

            <div className="mb-grid mb-grid-3">
              <Card>
                <Figure label="Budgeted" value={formatNZDWhole(budgetCents)} />
              </Card>
              <Card>
                <Figure label="Actually spent" value={formatNZD(spentCents)} />
              </Card>
              <Card>
                <Figure
                  label={
                    differenceCents >= 0 ? "Came in under by" : "Went over by"
                  }
                  value={formatNZD(Math.abs(differenceCents))}
                  tone={
                    differenceCents >= 0
                      ? "var(--status-ok)"
                      : "var(--status-error)"
                  }
                />
              </Card>
            </div>

            <ReviewForm
              book={book}
              periodStart={period.start.toISOString().slice(0, 10)}
              lines={lines}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

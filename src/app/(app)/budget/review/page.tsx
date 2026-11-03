// Month end: what actually happened last period, and one decision per
// category before the next one runs away.
//
// The three options are deliberately the whole vocabulary. A budget review
// that offers free-text adjustment becomes an accounting exercise nobody
// finishes; keep / carry / match is a decision you can make in two seconds per
// category, and all three are defensible answers.
//
// Layout follows the Money Book canvas (MonthEnd.dc.html).

import { AppShell } from "@/components/app-shell";
import { Alert, CalendarChip, EmptyState, Icon } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { formatNZD, formatNZDWhole } from "@/lib/money";
import { dateRange } from "@/lib/budget/period";
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

  // Full names, not a shortened form. The real category list has four
  // Insurance categories and two BNPL ones, and shortening turns the sentence
  // into "Insurance, Insurance, Insurance, Insurance".
  const OVERSPENT_NAMED = 5;
  const namedOverspends = overspent.slice(0, OVERSPENT_NAMED);
  const unnamedOverspends = overspent.length - namedOverspends.length;

  const short = (p: typeof period) => dateRange(p.start, p.end).replace(/\/\d{4}$/, "");

  return (
    <AppShell
      active="review"
      book={book}
      period={period}
      basePath="/budget/review"
      preserveQuery={params.period ? `period=${params.period}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Month end review</h1>
          <span className="t-s ink2">
            One decision per category. What happened last period is never rewritten.
          </span>
        </div>
        <div className="row wrap">
          <CalendarChip kind="pp" label="Reviewing" small>
            {short(previous)}
          </CalendarChip>
          <Icon name="chev" size="sm" />
          <CalendarChip kind="pp" label="Changes" small>
            {short(period)}
          </CalendarChip>
        </div>
      </div>

      {lines.length === 0 ? (
        <EmptyState
          icon="calcheck"
          title="Nothing to review"
          body={`Nothing was budgeted or spent in ${previous.label}.`}
        />
      ) : !previousWasBudgeted ? (
        // Every category would read as "over" against a budget of zero. That
        // is arithmetically true and tells the reader nothing, so the screen
        // says what actually happened instead.
        <EmptyState
          icon="calcheck"
          title={`${previous.label} had no budget set`}
          body={`So there's nothing to compare against yet. You spent ${formatNZD(
            spentCents,
          )} across ${lines.length} categories. This screen becomes useful at the end of ${
            period.label
          }, once a full period has run against the budget you've set now.`}
        />
      ) : (
        <>
          {overspent.length > 0 && (
            <Alert
              title={`${overspent.length} ${overspent.length === 1 ? "category" : "categories"} finished over`}
            >
              {namedOverspends.map((line) => line.name).join(", ")}
              {unnamedOverspends > 0 ? `, and ${unnamedOverspends} more` : ""}.
              Everything else came in under.
            </Alert>
          )}

          <div className="grid cols-3" style={{ gap: 12 }}>
            <div className="card stack" style={{ gap: 4 }}>
              <span className="row semi">
                <span className="badge b-fixed">Keep</span>
              </span>
              <span className="t-s ink2">Same budget again.</span>
            </div>
            <div className="card stack" style={{ gap: 4 }}>
              <span className="row semi">
                <span className="badge b-new">Carry</span>
              </span>
              <span className="t-s ink2">
                Add the underspend, or pay back the overspend. This period only.
              </span>
            </div>
            <div className="card stack" style={{ gap: 4 }}>
              <span className="row semi">
                <span className="badge">Match</span>
              </span>
              <span className="t-s ink2">
                Set the budget to what you actually spent, from now on.
              </span>
            </div>
          </div>

          <div className="card row wrap" style={{ gap: 28 }}>
            <div className="stack">
              <span className="t-xs ink3">Budgeted</span>
              <span className="m">{formatNZDWhole(budgetCents)}</span>
            </div>
            <div className="stack">
              <span className="t-xs ink3">Actually spent</span>
              <span className="m">{formatNZD(spentCents)}</span>
            </div>
            <div className="stack">
              <span className="t-xs ink3">
                {differenceCents >= 0 ? "Came in under by" : "Went over by"}
              </span>
              <span className={`delta ${differenceCents >= 0 ? "ahead" : "behind"}`}>
                {formatNZD(Math.abs(differenceCents))}
              </span>
            </div>
          </div>

          <ReviewForm
            book={book}
            periodStart={period.start.toISOString().slice(0, 10)}
            lines={lines}
            applyLabel={`Apply to ${short(period)}`}
            trendsHref={withBook("/budget/history", book)}
          />
        </>
      )}
    </AppShell>
  );
}

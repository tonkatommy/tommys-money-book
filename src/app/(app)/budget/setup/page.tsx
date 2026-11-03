// Set the budget.
//
// One form, one Save. Amounts are native inputs, Everyday/Fixed is a pair of
// radios per line and the pay cycle is its own small form — so the whole
// screen submits without a line of client JavaScript. The only interactive
// islands are the submit buttons' pending states.
//
// Layout follows the Money Book canvas (SetBudget.dc.html): bill and category
// lines on the left, the plan's arithmetic and the pay cycle on the right.

import { AppShell } from "@/components/app-shell";
import { Alert, CalendarChip, Icon } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { formatNZD } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
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
  const planned = (list: typeof categories) =>
    list.reduce(
      (sum, c) => sum + (seedFromAverages ? c.averageCents : c.standingCents),
      0,
    );
  const fixedCents = planned(fixed);
  const flexCents = planned(flexible);
  const unplannedCents = view.averageIncomeCents - fixedCents - flexCents;

  // Detected bills the reader hasn't pinned yet — the "we found these" list.
  const unpinned = [...suggestions.values()].filter((suggestion) => {
    const category = categories.find((c) => c.categoryId === suggestion.categoryId);
    return category && !category.isFixed;
  });
  const unpinnedCents = unpinned.reduce((sum, s) => sum + s.amountCents, 0);

  const discardHref = withBook(
    params.period ? `/budget/setup?period=${params.period}` : "/budget/setup",
    book,
  );

  return (
    <AppShell
      active="setup"
      book={book}
      period={period}
      basePath="/budget/setup"
      preserveQuery={params.period ? `period=${params.period}` : undefined}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Set budget</h1>
          <span className="t-s ink2">
            One amount per category, saved together. Amounts carry forward until
            you change them.
          </span>
        </div>
        <CalendarChip kind="pp" label="From">
          {nzDate(period.start)} onwards
        </CalendarChip>
      </div>

      <div className="grid cols-side" style={{ gap: 20, alignItems: "start" }}>
        <div className="stack" style={{ gap: 20 }}>
          {unpinned.length > 0 && (
            <section className="txl" aria-label="Detected bills">
              <div className="grp-h">
                <span className="stack" style={{ gap: 2 }}>
                  <span className="sect-t">
                    <Icon name="cycle" size="sm" />
                    {unpinned.length} bill{unpinned.length === 1 ? "" : "s"} detected
                  </span>
                  <span className="t-xs ink2">
                    Regular amounts around the same day each month. Not counted
                    as fixed until pinned.
                  </span>
                </span>
                <PinBillsForm
                  book={book}
                  periodStart={period.start.toISOString().slice(0, 10)}
                  count={unpinned.length}
                />
              </div>
              {unpinned.map((suggestion) => {
                const category = categories.find(
                  (c) => c.categoryId === suggestion.categoryId,
                );
                if (!category) return null;
                return (
                  <div key={suggestion.categoryId} className="bl">
                    <span className="bl-n">
                      <span className="semi">{category.name}</span>
                      <span className="range">
                        Seen {suggestion.occurrences} times
                        {suggestion.estimated ? " · amount varies" : ""}
                      </span>
                    </span>
                    <span className="bl-t t-xs ink3">
                      Pinning sets it to Fixed below
                    </span>
                    <span className="bl-d t-s ink2">Around day {suggestion.dueDay}</span>
                    <span className="bl-a m" style={{ textAlign: "right" }}>
                      {formatNZD(suggestion.amountCents)}
                    </span>
                  </div>
                );
              })}
            </section>
          )}

          <BudgetForm
            book={book}
            periodStart={period.start.toISOString().slice(0, 10)}
            flexible={flexible}
            fixed={fixed}
            seedFromAverages={seedFromAverages}
            discardHref={discardHref}
          />
        </div>

        <aside className="stack" style={{ gap: 20 }}>
          <section className="card pad-l stack" style={{ gap: 12 }} aria-label="Totals">
            <span className="lbl">A pay period · planned</span>
            <div className="eq">
              <span className="op" />
              <span>Average pay, last 3 periods</span>
              <span className="m in">+{formatNZD(view.averageIncomeCents)}</span>
              <span className="op">−</span>
              <span>Fixed bills</span>
              <span className="m">{formatNZD(fixedCents)}</span>
              <span className="op">−</span>
              <span>Everyday</span>
              <span className="m">{formatNZD(flexCents)}</span>
              <span className="op tot">=</span>
              <span className="tot">Not yet planned</span>
              <span className="m tot" style={{ color: unplannedCents < 0 ? "var(--bad)" : undefined }}>
                {unplannedCents >= 0 ? "+" : "−"}
                {formatNZD(Math.abs(unplannedCents))}
              </span>
            </div>
            {unpinned.length > 0 && (
              <p className="t-xs ink3">
                Detected bills ({formatNZD(unpinnedCents)}) aren&apos;t included
                until pinned.
              </p>
            )}
            {unplannedCents < 0 && (
              <p className="t-xs" style={{ color: "var(--bad)" }}>
                This plan spends more than you usually earn in a period.
              </p>
            )}
          </section>

          <PayCycleForm
            anchorDay={settings.anchorDay}
            splitFortnightly={settings.splitFortnightly}
            periodLabel={period.label}
            flexBudgetCents={view.totals.flexBudgetCents}
          />

          <Alert level="info" title="Past periods stay as they were">
            Changes apply from {nzDate(period.start)}. Reports and How past periods
            went keep the budget that was set at the time.
          </Alert>
        </aside>
      </div>
    </AppShell>
  );
}

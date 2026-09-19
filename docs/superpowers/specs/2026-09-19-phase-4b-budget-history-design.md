# Phase 4b - Budget history: design

**Date:** 19/09/2026
**Input:** [implementation-plan.md](../../implementation-plan.md) §4 (Charts)
and §6 Phase 4; [Phase 3b budget design](2026-08-15-phase-3b-budget-design.md);
[Phase 3c reports design](2026-08-24-phase-3c-reports-design.md) §6.
**Status:** agreed with Tommy 19/09/2026, ready to implement.

---

## 1. Scope

The plan lists "budget vs actual" as a Phase 4 item. Phase 3b already built it
for the **current** pay period and said so (3b spec §1): the `/budget`
overview is budget vs actual for the period you are in. What nothing in the
app answers yet is the question across periods: is this budget realistic?
Which categories run over every month, which are padded, and is the whole
thing drifting? That is what 4b builds.

**In scope:**

- **Whole-budget trend:** total allowance vs total spent for each of the last
  six complete pay periods, with over/under per period.
- **Per-category history:** each category's allowance vs spent across the
  same six periods, with a consistency summary ("over in 5 of 6").
- **Adjustment hints:** categories consistently over or under their standing
  budget by a meaningful margin, with a suggested new amount. Suggestions
  only.
- **Both books,** via the existing `?book=` toggle.
- **Recharts,** as a client-side enhancement over a server-rendered table
  that always carries every figure (§6).

**Not in scope:**

- **Savings goals.** Phase 4c, not yet designed. Nothing here blocks it.
- **Writing budgets from a hint.** A hint links to `/budget/setup`; it never
  saves anything. Budgets are written only when a human saves (3b spec §3),
  and a one-click "accept suggestion" would be a second write path to
  `CategoryBudget` for a convenience nobody has asked for yet.
- **Prefilling `/budget/setup` from a hint.** It would need a new query-param
  contract on a form that currently has none. Revisit if typing one number
  turns out to be the friction.
- **A selectable window.** Fixed at six periods (§2). A `?periods=` param is
  cheap to add later and nothing here precludes it.
- **Charts anywhere else.** The `/reports` ranked bar tables and the `/budget`
  `DayBars` stay as they are. This phase introduces the chart library for
  the one question a table answers badly, a trend, and doesn't retrofit it.
- **Income.** The trend compares budget to spending. Whether income covers
  the budget is already on the `/budget` overview (`averageIncomeCents`).
- **Schema changes.** None. Everything reads `CategoryBudget`,
  `BudgetSettings` and `Transaction` as they stand.

---

## 2. The window, and the periods that don't count

**Six complete pay periods, ending with the one before the current period.**
At a 20th anchor, on 19/09/2026 the running period is
20/08/2026–19/09/2026, so the window is 20/02/2026–19/03/2026 through
20/07/2026–19/08/2026.

**The running period is excluded, not shown partial.** On day 5 every
category looks under budget, which is arithmetic, not information: the same
reason `BudgetView` carries `averageIncomeCents` instead of comparing a full
budget to partial income. A partial bar on a trend chart reads as a good
month. The screen links to `/budget` for the running period instead.

**A period before a category's first budget row has no budget, not a zero
budget** (invariant 7). Budgets only exist from mid-August 2026, so for the
first few months of real use most of the window is "no budget, some
spending". Those periods:

- appear in the table as spent with a "no budget" marker, not as 100% over;
- are drawn on the chart as spending with no budget line for that period;
- are **excluded from the over/under counts and from the hint statistics.**
  Counting them as over would make every category look chronically over
  budget purely because the feature is new.

Six rather than twelve for the same reason: at twelve, the default view would
be mostly pre-budget gaps for the rest of 2026.

---

## 3. One definition of "the allowance for a period"

`categoryViews` in `src/lib/budget/query.ts` currently resolves a category's
budget for a period in two inline steps:

1. the most recent `CategoryBudget` row with `periodStart <= period.start`
   (`resolveBudgets`);
2. that row's `carryoverCents` only if the row was written **for this
   period**, since an inherited row's carryover was a one-off correction and
   re-applying it every month would compound (the comment at
   `query.ts:221`).

History needs exactly the same answer for six periods at once. A second copy
of those two rules in a history query is the failure this app is prone to:
the overview and the history screen quietly disagreeing about what a month's
budget was, with every total on both screens still balancing.

So both steps move into pure functions in `src/lib/budget/history.ts` (§4),
and **`categoryViews` is refactored to call them.** The refactor must not
change any figure on `/budget`; the existing `totals.test.ts` and
`mutate.test.ts` stay green, and the new tests pin the carryover rule
directly.

---

## 4. Data layer

Same three-way split as the rest of `src/lib/budget/`: pure logic, Prisma
reads, and no writes (this phase adds none).

### `src/lib/budget/history.ts` - pure, unit-tested, no Prisma

- `type BudgetRow = { categoryId; periodStart: Date; amountCents;
  carryoverCents; isFixed }`, the subset of `CategoryBudget` these functions
  read.
- `resolveRow(rows, categoryId, period): BudgetRow | null`: the most recent
  row for the category with `periodStart <= period.start`. Takes rows in any
  order and does not rely on the caller having sorted them.
- `allowanceFor(row, period): { standingCents; carryoverCents; allowanceCents }
  | null`: `null` when `row` is null (no budget). Carryover only when
  `row.periodStart` equals `period.start`. Allowance through the existing
  `allowanceCents`, so the floor-at-zero rule stays in one place.
- `type PeriodCell = { period; allowanceCents: number | null; standingCents:
  number | null; spentCents: number }`. `null` allowance means no budget.
- `varianceCents(cell): number | null`: `allowance - spent`, positive under,
  negative over; `null` for a no-budget cell. Spent can be negative (a refund
  larger than the month's spending, which invariant 2 keeps visible rather
  than clamping), and the subtraction handles it without a special case.
- `summariseCategory(cells): CategorySummary`: `budgetedCount`,
  `overCount`, `underCount`, `averageSpentCents` (over budgeted periods only,
  §2), `latestStandingCents`. `budgetedCount === 0` is a real state, not a
  divide-by-zero: the average is `null`, not `NaN`.
- `budgetHint(summary, cells): BudgetHint | null`: §8.
- `periodTotals(cellsByCategory, period)`: total allowance and spent for one
  period, summing only categories that had a budget that period, plus a
  separate `unbudgetedSpentCents` so spending outside the budget is shown
  rather than silently dropped from, or silently added to, the comparison.

### Reads: `src/lib/budget/query.ts`

- `getBudgetHistory(book, period, settings, now)`: `period` is the current
  period, as `resolvePeriod` already returns it. Uses `previousPeriods(period,
  6, anchorDay)` for the window. In parallel:
  - the book's `EXPENSE` categories;
  - **one** `categoryBudget.findMany` for every row with `periodStart <=` the
    newest window period's start, which `resolveRow` then resolves per period
    in memory, rather than six round trips each re-reading overlapping rows;
  - six `spentByCategory` calls, one per period, reusing the existing
    function so "what counts as spent" stays defined in one place. Six small
    `groupBy`s beat one large query bucketed by date in JS, which would be a
    second definition of the period boundary;
  - six uncategorised counts, one per period, scoped by `account: { book }`
    exactly as `getBudgetView` does.
- Categories with no budget in any window period **and** no spending in any
  window period are dropped, the same "63 categories, a month touches a
  fraction" filter as `getBudgetView`.
- **Every category read filters on `category: { book, kind: "EXPENSE" }`**,
  so `TRANSFER` and `OWNER` never enter the history, with no special case,
  as in 3b.
- `getCategoryDetail` gains the same six-period history for its one
  category, for the drilldown card (§5). It calls the same functions and
  does not get its own query.

---

## 5. Screens

Server components throughout; the chart is the only client island (§6).
`?book=` selects the book, as everywhere in `/budget`.

### `/budget/history` (new)

`src/app/(app)/budget/history/page.tsx`, `export const dynamic =
"force-dynamic"`, one `now = new Date()` captured for the whole render and
passed to `resolvePeriod` and `getBudgetHistory` (the reason is in
`resolvePeriod`'s own comment).

In order:

1. **Head:** the window as dates, "20/02/2026 – 19/08/2026", in NZ format,
   the book toggle, and a link to `/budget` for the running period.
2. **Quality alerts.** Uncategorised transactions in the window, as a total
   with a link to `/transactions?uncategorised=1` with the window's dates.
   Uncategorised spending understates every period and every category on
   this page at once, and it's the most likely reason a category looks
   under budget. Plus the unassigned-account alert if any account has no
   book.
3. **Trend:** the chart (§6), then a table with one row per period: period
   label, allowance, spent, over/under, and unbudgeted spending when
   non-zero. The table is the source of truth; the chart draws the same
   array.
4. **Hints:** one line per hint (§8), each linking to `/budget/setup` for
   the book. Rendered only when there is at least one; the empty state says
   nothing is consistently off rather than leaving a blank card.
5. **Categories:** every category in the window, ordered by `overCount`
   descending then name, each showing "over in X of Y budgeted periods",
   average spent vs latest standing budget, and a link to its drilldown.
   Deliberately not a category-by-period grid: at phone width, seven columns
   of dollar amounts don't fit, and the per-period detail lives on the
   drilldown where there's room for it.

**First run** (no `CategoryBudget` rows for the book at all), which is the
likely state for BUSINESS: the page says there is no budget to compare
against yet and links to `/budget/setup`. No chart, no table of "no budget"
rows.

### `/budget/category/[id]` (existing, extended)

Gains a **History** card under the current-period content: the same chart
and table shape, for one category over six periods. This is where the
per-period detail for one category lives.

### `/budget` (existing)

Gains a "History" link beside "Set the budget". No other change.

---

## 6. Charts: Recharts, as an enhancement

### The finding that shapes this section

Recharts 3.10.1 was installed and tested on 19/09/2026 by rendering a
fixed-size `BarChart`, a `ComposedChart` and a `ResponsiveContainer` through
`react-dom/server`'s `renderToString`, which is what Next does for a client
component's first paint. All three produced the same output:

```html
<div class="recharts-wrapper" style="...width:600px;height:300px"></div>
```

No `<svg>`, no bars, no axis labels. Recharts 3 computes its layout into an
internal store that fills only during browser effects, so **its server HTML
is an empty box.** With JavaScript disabled, a Recharts chart renders
nothing.

This amends 3c §6, it doesn't contradict it. 3c declined Recharts for a
ranked breakdown a table answers fully, and the plan's Charts line says to
revisit "only if a genuinely chart-shaped question" arrives. A trend across
periods is that question: six rows of numbers don't show a drift the way a
line does. It's worth being precise about what's new, though. The app already
has client components (the setup, review and IR3 forms use `useActionState`),
but every one of them server-renders complete, working HTML. **This is the
first component whose server HTML is empty.**

### How the no-JavaScript rule survives

- **The table carries every figure, always.** It is server-rendered and sits
  directly under the chart. The chart adds a picture and tooltips, never a
  number the table lacks.
- **The chart island renders nothing on the server.** Not a reserved empty
  box: a blank 300px rectangle on a no-JS page looks broken, which is worse
  than no chart. It mounts client-side, and the resulting layout shift is
  the accepted cost.
- **One data source.** The page passes the chart the same period array the
  table renders, as plain serialisable props: labels as strings, amounts as
  integer cents. The chart formats its axis and tooltip through
  `formatNZDWhole` from `src/lib/money.ts`, not its own formatter.

### Component

`src/components/charts/budget-trend-chart.tsx`, `"use client"`, a
`ComposedChart`: spent as bars, allowance as a stepped line, and no-budget
periods as bars with no line segment. Recharts ships no `"use client"`
directive of its own, so it is imported only from this file and never from
a server component.

Colours come from the design tokens (`--money-out`, `--text-secondary` and
so on). Whether a CSS custom property works in an SVG presentation attribute
as Recharts sets it needs checking in the browser during implementation. If
it doesn't, the component reads the computed token values once on mount; it
never hardcodes a hex.

### Cost, measured not guessed

The client-bundle cost of Recharts is not stated here because it hasn't been
measured. PR 2 records the route's First Load JS from `next build` output
before and after, in the PR description. If it's disproportionate for one
chart, that is the point to reconsider hand-rolled SVG, with a number in hand.

---

## 7. Dependency

`recharts@^3.10.1` is added to `package.json` (installed 19/09/2026 on this
branch). It peers React `^16.8 || ^17 || ^18 || ^19`, so there is no conflict
with the pinned 19.2.4. It pulls `react-is@16.13.1`, which satisfies its own
peer range and is already present in the tree via `eslint-plugin-react`.

When this lands, the plan's §4 Charts line, `README.md`'s stack table and
`AGENTS.md`'s "nothing charts yet" line are all updated in the same PR. All
three currently say there is no chart library.

---

## 8. Adjustment hints

A hint says: "this category's standing budget and what you actually spend
have disagreed consistently enough to be worth a look. The rules below were
agreed 19/09/2026.

A category gets a hint when all of these hold:

1. **At least 3 budgeted periods** in the window. Fewer is an anecdote.
2. **Consistent direction:** over in every one of the last 3 budgeted
   periods, or under in every one of them. A category that alternates is
   noisy, not wrong, and averaging would hide that.
3. **Material margin:** the average spent differs from the latest standing
   budget by at least **10% and at least $20**. Both, so a $5 category
   doesn't nag over $1, and a $2,000 category doesn't stay silent over $150.

The comparison is against the **standing** budget, not the allowance.
Carryover is a one-off per period (§3) and would otherwise make a category
look over or under because of last month's correction rather than its own
budget. The suggested amount is `roundToDollar(averageSpentCents)`, the same
rounding `monthEndAmounts`'s "match" option uses, so the two surfaces suggest
the same kind of number.

Guards, all tested:

- **Zero standing budget:** there's no percentage to compute. A category
  budgeted at $0 with consistent spending gets a hint worded as "budgeted $0,
  averaging $X", not a divide-by-zero or an infinite percentage.
- **Negative average spent** (refunds dominating): no hint. Suggesting a
  negative budget is meaningless, and `allowanceCents` would floor it anyway.
- **Fixed bills** get hints like anything else. A fixed bill consistently
  above its budget is the clearest hint there is. Their wording says
  "bill", so an `estimated` fixed amount reads as "the estimate is off"
  rather than "you overspent".

---

## 9. Testing

Vitest, no database, per the Phase 3a spec §7 and every spec since:

- `history.test.ts`:
  - `resolveRow`: the most recent row on or before the period wins; a row
    dated after the period is ignored; rows in unsorted order; no rows is
    `null`, not a zero budget.
  - `allowanceFor`: carryover applies when the row is for this period and
    is dropped for an inherited row, the compounding case `query.ts:221`
    exists to prevent; allowance floors at zero with a large negative
    carryover.
  - `varianceCents` with a negative spent (refund) and with no budget.
  - `summariseCategory`: no-budget periods excluded from counts and the
    average; zero budgeted periods gives a `null` average, not `NaN`.
  - `budgetHint`: fewer than 3 budgeted periods, alternating direction, a
    margin under 10%, a margin under $20, zero standing budget, negative
    average, and one positive case in each direction.
  - `periodTotals`: unbudgeted spending kept separate rather than dropped
    or merged.
- The `categoryViews` refactor is covered by the existing budget tests
  staying green, and it is verified by hand: `/budget` figures for the
  current period are identical before and after, for both books.

Page behaviour is verified by hand against the dev server at phone and
desktop widths, **with JavaScript disabled** (every figure present in the
table, no empty chart box) and enabled (chart matches table), for both
books, including BUSINESS in its first-run state.

---

## 10. Sequencing

Two PRs on `feat/phase-4b-budget-history`, split by correctness risk as 3c
and 4a were:

1. **`history.ts`, the `categoryViews` refactor onto it, `getBudgetHistory`,
   and the `/budget/history` page with the table only, no chart.** All of
   the arithmetic and the one refactor that could shift an existing figure.
   Fully usable with no chart at all, which also proves the no-JS path
   before anything depends on JS.
2. **The chart component, the drilldown History card, and the
   docs updates** (§7), with the First Load JS measurement (§6) in the PR
   description.

When PR 2 lands, update the roadmap in `README.md` and the Phase 4 entry in
`docs/implementation-plan.md` in the same PR, per the working agreement.

This spec PR also carries the `recharts` install, since the finding in §6
came from testing that exact version.

# Phase 3c - Reports: design

**Date:** 24/08/2026
**Input:** [implementation-plan.md](../../implementation-plan.md) §6 Phase 3–4;
[Phase 3a transactions design](2026-08-02-phase-3-transactions-design.md);
[Phase 3b budget design](2026-08-15-phase-3b-budget-design.md).
**Status:** agreed with Tommy, ready to implement.

---

## 1. Scope

Phase 3b redefined "dashboard" as the pay-period budget surface. That was the
right call, since a dashboard that shows what you spent without saying what
you *meant* to spend is a report rather than a tool, but it left four items
the plan listed under Phase 3 unbuilt. They are all reporting, they all read
the same data the same way, and they are all answers to tax questions rather
than to "can I afford this today?". 3c is that tail.

**In scope:**

- GST-threshold running 12-month turnover for Tommy Tinkers, surfaced in the
  UI, and the date fix it needs first (§3).
- FY-to-date income and expenses per book, transfers excluded.
- Category breakdown for a financial year.
- Monthly breakdown, the live version of the Financial Breakdown sheet.
- A `/reports` section to hold them.

**Not in scope:**

- **Charts.** No chart library. §6 has the reasoning; the short version is
  that the first client component on a server-rendered app is not worth
  paying for a bar chart. The implementation plan's Recharts line is amended
  in the same PR so this stays decided.
- **The IR3 pack, the home office 12.57% calc and the rental gross-up.** Phase
  4. 3c surfaces figures for Tommy to read; Phase 4 produces a document for
  Garreth, which is a different problem with a different audience.
- **Any xlsx or PDF export.** Same reason.
- **A combined personal + business view.** Personal and business never mix
  anywhere else in the app and the IR3 needs them separate. The existing
  `?book=` toggle is the only view selector.
- **Schema changes.** There are none. Everything below reads what Phases 1–3b
  already store.

---

## 2. The two date regimes, and why that is the main risk here

`/budget` runs on a pay period: 20th to 19th, anchored on payday, because the
question it answers is "how much until payday?".

`/reports` cannot use that period. The GST threshold is a rolling 12 months
from today, the financial year runs 01/04 to 31/03, and the Financial
Breakdown sheet is calendar months. Those are facts about IRD, not about the
app, and bending them to the pay anchor would produce figures that are
defensible nowhere.

So the app carries two date regimes, and the failure mode is a person reading
August on one screen and August on the other and comparing them. They are not
the same August and never will be.

The mitigation is not subtle and does not need to be: **every reports screen
states its literal date range in the heading**, in DD/MM/YYYY, next to the
figure. "FY2027 (01/04/2026 – 31/03/2027)". "12 months to 24/08/2026". A
figure without its range is not shown anywhere in this section.

FY is derived, never stored, exactly as the plan says (§5): NZ FY is the year
of `date + 9 months`, so 15/03/2027 is FY2027 and 15/04/2027 is FY2028. The
plan calls for one SQL expression; this spec computes the bounds in
TypeScript instead and filters on them, because `period.ts` already solves
the identical problem that way, the result is unit-testable without a
database, and a raw SQL fragment would be the only one in the codebase.

---

## 3. The GST turnover figure is currently wrong, and is fixed first

`rollingBusinessTurnoverCents` in `src/lib/categories/verify.ts` already
computes the number. It has a date bug that must be fixed before it is put on
a screen.

```ts
asAt: Date = new Date()                    // a real instant, not a calendar date
date: { gt: from, lte: asAt }              // compared against @db.Date at UTC midnight
```

`Transaction.date` is a bare `@db.Date`, which Postgres returns at UTC
midnight. `asAt` is the current instant. New Zealand is 12–13 hours ahead of
UTC, so from NZ midnight until NZ noon, UTC has not yet reached today's
midnight and **today's business income is excluded from the window**. The far
boundary of the 12 months slides with it, so the window is not 12 months and
is not the same 12 months at 9am as at 9pm.

This is invariant 5 (`AGENTS.md`), in the one function 3c exists to surface.

It does not matter yet. Turnover is $982.84 against a $60,000 threshold. It
matters the first time the figure is read in anger, because GST registration
is triggered by turnover in the **past** 12 months, so by the time anyone
cares, the number is already describing history and cannot be recomputed from
a better clock.

The fix, in place in `verify.ts` so the seed script keeps working:

- `asAt` defaults to `nzToday()` from `src/lib/budget/period.ts`, a
  UTC-midnight calendar date.
- The window becomes date-to-date: `gte` the day after the same date one year
  earlier, `lte` `asAt`. Both operands are then UTC-midnight calendar dates
  and the comparison means what it reads like.
- The one-year-back calculation does not use `setFullYear` on a mutated copy.
  29/02 minus a year is 29/02 in a year that has no 29th, which silently rolls
  into March. It goes through the same clamped `utcDate` arithmetic
  `period.ts` uses for short months.

A unit test covers the NZ boundary (a transaction dated today is included at
09:00 NZ, not only after noon) and the leap-day case.

`taxTagTotals` in the same file is left alone. It loads every category with
every transaction attached, which is fine for a CLI run over 2,000 rows and
is not a pattern the reports layer copies.

---

## 4. Data layer: `src/lib/reports/`

Pure logic separate from the Prisma reads, matching `src/lib/budget/` and
`src/lib/categories/`.

- **`fy.ts`** is pure, tested, no Prisma. `currentFY(now)`, `fyFor(date)`,
  `fyBounds(fyLabel)`. A financial year is `{ label: "FY2027", start, end }`
  with `start` and `end` as UTC-midnight dates, matching `@db.Date`. "Now"
  resolves through `nzToday()`, never a bare `new Date()`. The 01/04 boundary
  and the 31/03 end are the whole of the logic and both are tested.

- **`query.ts`** holds the Prisma reads, one function per screen, following
  `src/lib/budget/query.ts`:

  - **FY totals.** `transaction.groupBy` on `categoryId`, scoped by
    `category: { book, kind: { in: ["INCOME", "EXPENSE"] } }` and the FY
    bounds. `TRANSFER` and `OWNER` categories are excluded by that filter,
    which is what keeps money moving between Tommy's own accounts out of the
    totals without a special case, and it is the same mechanism 3b relies on.
  - **Category breakdown.** The same query, kept per-category and ranked by
    magnitude, with each category's share of its side's total.
  - **Monthly breakdown.** One query over the FY, grouped by category, bucketed
    into calendar months in TypeScript rather than in SQL. Twelve buckets over
    one year of rows is not worth a `date_trunc` and a raw query.
  - **Data-quality counts.** `uncategorisedCount` and
    `unassignedAccountCount` for the FY range, per §5.

  **Expenses are stored negative and displayed positive**, and the flip
  happens once, here, at the query boundary. `src/lib/budget/query.ts` does
  the same for the budget screens. It does not happen a second time in a
  component or a formatter.

- **GST** stays in `src/lib/categories/verify.ts` and is imported from
  `reports/query.ts`. Moving it would churn the seed script's import for no
  gain, and it is genuinely a verification assertion that the UI also happens
  to show.

No `mutate.ts`. Nothing in this phase writes.

---

## 5. Uncategorised transactions are the headline risk

Every figure in this section filters on `category.kind`. A transaction with no
category is therefore absent from income, absent from expenses, absent from
the breakdown, and absent from the monthly view, and nothing on the page
looks wrong. The totals balance. The chart adds up. The number is simply not
the truth.

This is the characteristic failure of the app, stated in `AGENTS.md`, and the
FY screens are where it does the most damage, because an FY figure is the one
someone eventually reads out to an accountant.

So, on every reports screen, not just the index:

- The count of uncategorised transactions **within the range being shown**,
  as an alert linking to `/transactions?uncategorised=1` with the same dates.
  3b already does this on the budget overview; this is the same treatment for
  a range that matters more.
- The count of accounts with `book: null`, whose transactions are in no book
  at all and so in no report.

Neither is decoration. A reports screen that cannot say how complete it is has
not answered the question.

---

## 6. Screens

Server components throughout. No mutations, so no Server Actions and no forms
beyond the FY selector, which is links. Book stays in the query string
(`?book=BUSINESS`), and the financial year joins it (`?fy=2027`), matching the
existing `?book=` and `?period=` conventions, so every view is bookmarkable,
the back button is honest, and there is no client state.

| Route | Screen |
|---|---|
| `/reports` | index: FY-to-date income, expenses, net; GST card (business only); links to the two breakdowns |
| `/reports/categories` | ranked category breakdown for the FY |
| `/reports/months` | month-by-month income, expenses, net: the Financial Breakdown, live |

The GST card renders only in the business book. A rolling turnover figure
against the registration threshold is meaningless for the personal book and
showing it there with a zero would invite the question of why it is zero.

**Nav** goes from six items to seven. `src/components/ui/nav.tsx` gains one
entry:

```ts
{ key: "reports", href: "/reports", label: "Reports", short: "Reports" }
```
At 375px that is roughly 53px per tab in `BottomNav`, still above the 44px
target the design system holds to, but it is the tightest thing in this phase
and is checked on the actual phone before the PR merges, not after. If it
does not hold, the fix is a shorter `short` label, not a nav restructure.
Folding "Set budget" into `/budget` is a change to a working 3b screen and
does not belong in this PR.

**No chart library.** The plan named Recharts. Recharts 3.10.1 does peer React
19, so there is no version fight with the pinned 19.2.4, and it was considered
for the category breakdown. It is declined because every screen in this app is
a server component that works with JavaScript disabled, and Recharts is a
client component, so it would be the first client JS on a reporting screen,
in exchange for a bar chart, on a section whose entire value is the numbers.
The breakdown is a ranked bar table instead: labels, amounts and proportional
bars, server-rendered.

That needs one new primitive in `src/components/ui/data.tsx`, alongside
`DayBars` rather than replacing it. `DayBars` is vertical, one bar per day,
max-scaled and hardcoded to `--money-out`; the breakdown wants horizontal bars
with a label, an amount and a share. Call it `RankedBars`, same file, same
max-scaling approach.

The monthly view is a table with income, expenses and net columns, not a
chart. Three series at phone width read better as three columns of numbers
than as anything drawn.

Consequence: 3c adds **no dependency and no client JavaScript**. The
JS-disabled rule in `AGENTS.md` is untouched and needs no exception.

---

## 7. Testing

Vitest, no database, as every existing test in this repo:

- `fy.test.ts` covers the 01/04 boundary in both directions (31/03 and 01/04
  land in different years), the 31/03 end, `fyFor` against the plan's worked
  examples (15/03/2027 → FY2027, 15/04/2027 → FY2028), and that "now"
  resolves in NZ rather than UTC.
- `verify.test.ts` covers the GST window: a transaction dated today is inside
  it at 09:00 NZ, the far boundary is exactly 12 months and does not move
  with the clock, and 29/02 does not roll into March.

Page behaviour needs a live database and is verified by hand at both a phone
and a desktop width, as Phases 0–3b were. Specifically: the FY figures are
reconciled against `npm run categories:seed --verify` and against the frozen
Excel archive for an overlapping month, because a reporting layer that agrees
with itself has proved nothing.

---

## 8. Sequencing

Two PRs on `feat/phase-3c-reports`, because the correctness risk is not spread
evenly across the phase:

1. **`fy.ts`, the GST date fix, `reports/query.ts`, and `/reports`.** All of
   the arithmetic and every way this phase can produce a plausible wrong
   number. Small enough to review line by line.
2. **`/reports/categories`, `/reports/months`, and `RankedBars`.** Mostly
   screens over a data layer that is already reviewed and tested.

Roughly two weekends part-time.

When the second PR lands, Phase 3 is complete against the original plan, and
the working agreement's "update the roadmap when a phase lands" applies to
both `README.md` and `docs/implementation-plan.md` in that PR, including the
Phase 3 completion note that 3a and 3b never got.

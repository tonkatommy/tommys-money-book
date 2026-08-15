# Phase 3b — Budget: design

**Date:** 15/08/2026
**Input:** [implementation-plan.md](../../implementation-plan.md) §6 Phase 3–4;
[Phase 3a transactions design](2026-08-02-phase-3-transactions-design.md);
the `Money Book — Budget` / `Money Book — App` prototypes in the Claude Design
project `be28709a-d521-4a24-8404-a9233306867c`.
**Status:** agreed with Tommy, ready to implement.

---

## 1. Scope

The implementation plan puts "budget vs actual" in Phase 4 and the dashboard in
Phase 3. In practice they're the same screen: a dashboard that shows what you
spent without saying what you *meant* to spend is a report, not a tool. This
spec builds the budget surface and treats it as the Phase 3b dashboard.

**In scope:**

- A pay-period budget, anchored on payday rather than the calendar month.
- An overview answering three questions at a glance: am I over or under, what
  is safe to spend today, what bills haven't hit yet.
- A per-category drilldown, with a separate treatment for fixed bills.
- A screen to set the budget, seeded from the last three periods' actuals.
- A month-end review: one decision per category, applied to the running period.
- A budget-annotated transaction list at `/transactions`.
- The design system from the prototype, ported app-wide.

**Not in scope:** the rest of Phase 3a (`/transactions` filters, bulk
categorise, `/transactions/[id]`, `/transactions/new`, `/transfers`) — this
builds the annotated list at that URL and the management features layer on top
later. Savings goals and the IR3 pack stay Phase 4.

---

## 2. The pay period

Tommy is paid monthly on the 20th, so a calendar-month budget splits every pay
cycle in half and makes "how much is left?" unanswerable. The period runs
anchor-day to anchor-day minus one — 20 Jul to 19 Aug — and the anchor is
configurable because the pay cycle is a fact about the employer, not the app.

`src/lib/budget/period.ts` is pure and tested. Two things it must get right:

- **Short months.** An anchor of 31 has no January→February equivalent, so the
  start clamps to the last day of the month.
- **NZ versus UTC.** `Transaction.date` is a bare `@db.Date` stored at UTC
  midnight (see the comment at the foot of the old status page). "Today" is
  therefore derived in `Pacific/Auckland` and only then converted to a
  UTC-midnight `Date`, so the period boundary flips at NZ midnight. Getting
  this backwards moves every transaction dated the 20th into the wrong period,
  which is precisely the boundary the whole model rests on.

A fortnightly display split is a setting, not a second period model: the pay
still arrives monthly, so it halves the everyday budget for display and nothing
else.

---

## 3. Schema

```prisma
model BudgetSettings {          // one row
  id               String   @id @default("singleton")
  anchorDay        Int      @default(20)
  splitFortnightly Boolean  @default(false)
  updatedAt        DateTime @updatedAt
}

model CategoryBudget {
  id             String   @id @default(cuid())
  categoryId     String
  periodStart    DateTime @db.Date
  amountCents    Int
  isFixed        Boolean  @default(false)
  dueDay         Int?
  estimated      Boolean  @default(false)
  carryoverCents Int      @default(0)
  note           String?
  category       Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([categoryId, periodStart])
  @@index([periodStart])
}
```

**A period with no rows is not an empty budget.** Each category resolves to its
most recent row with `periodStart <= period.start`, so a budget continues until
it's changed. That kills the roll-forward job the obvious design needs, and
with it the class of bug where the budget silently becomes zero because a
scheduled task didn't run. Rows are written only when a human saves.

`isFixed` marks a bill — something with a due date that arrives whether you
like it or not. Fixed categories are held out of the pace calculation and
subtracted from safe-to-spend instead, because pacing a mortgage payment
across a month is meaningless.

---

## 4. Data layer — `src/lib/budget/`

Pure logic separate from the Prisma reads, matching `src/lib/categories/`.

- **`period.ts`** — §2. `payPeriodFor(date, anchorDay)`, `previousPeriods()`.
- **`totals.ts`** — safe-to-spend, pace, projection. Ported from the
  prototype's `totals()`, in integer cents, with the divide-by-zero guards the
  prototype doesn't need and a real app does: a zero budget, and day one of a
  period where the run-rate projection would divide by zero.
- **`recurring.ts`** — fixed-bill detection. Groups a category's transactions
  by `normaliseDescription` from `src/lib/categories/normalise.ts` — which
  already collapses card numbers and per-transaction references, the exact
  noise that makes a monthly bill look like twelve unrelated payments — and
  flags a roughly-monthly cadence with a stable amount.
- **`query.ts`** — Prisma reads. Actuals via `groupBy` on `categoryId` scoped
  by `category: { book, kind: "EXPENSE" }`; three-period averages as one query
  over the whole range divided by three; balances from
  `account.aggregate({ _sum: { balanceCents } })`. `TRANSFER` and `OWNER`
  categories are never budgeted, which is what keeps transfers out of the
  numbers without a special case.
- **`mutate.ts`** — `saveBudgets`, `setFixed`, `applyMonthEnd`,
  `savePayCycle`. Errors returned, not thrown (Phase 3a spec §6).

Every write re-validates that the category's book matches what the caller
claims. The UI can't produce a violation, and it's checked anyway: this is a
second independent path to the same data that `src/lib/categories/match.ts`
already guards, and a book leak is invisible once written.

Server Actions are also reachable as direct POSTs, not only through the UI
(`node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
says so explicitly). `src/proxy.ts` covers them, and each action re-checks the
session anyway.

---

## 5. Screens

Server components throughout, mutations as Server Actions on plain `<form>`s,
book selection in the query string (`?book=BUSINESS`) so the toggle is two
links and the overview needs no client JS at all.

| Route | Screen |
|---|---|
| `/` | redirect to `/budget` |
| `/budget` | overview |
| `/budget/category/[id]` | drilldown, keyed by id — names are editable |
| `/budget/setup` | set budgets, pay cycle, fixed bills |
| `/budget/review` | month-end, one decision per category |
| `/transactions` | budget-annotated list |
| `/sync` | the status page, moved from `/` |

Setup is one form of amount inputs with a single Save; review is one form of
choice groups with a single Apply. Both work without JavaScript.

Two states the prototype had no concept of and the real app hits on day one:
no budget rows at all (`/budget` shows the first-run screen, seeded from
three-period averages), and uncategorised transactions — which silently
understate every category on the page, so they get an alert linking to the
list rather than being quietly absorbed.

---

## 6. Design system

The prototype's tokens land in `src/app/globals.css` under their **original
names** (`--surface-card`, `--text-primary`), with Tailwind `@theme` aliases
layered on top for utility generation. Keeping the design system's own names
means the CSS pulled from the design project applies verbatim and stays
diffable against future pulls, instead of being a one-way translation nobody
can re-run.

Geist comes from `next/font/google` as it already does — not the design
system's Google Fonts `@import`, which would add a render-blocking external
request to a LAN-only app.

The layout classes from the prototype's `app.css` come across as-is. They
encode the breakpoints the design actually reasons about — 768px for
sidebar-versus-bottom-nav, 900px for two-column content, 640px for stacked
controls — and there is no device toggle: one layout, driven by media queries.

---

## 7. Testing

Vitest, no database, as every existing test in this repo:

- `period.test.ts` — anchor maths, short-month clamping, the NZ/UTC boundary,
  `dayOfPeriod`/`daysLeft`, labels.
- `totals.test.ts` — safe-to-spend, pace delta, projection, over budget, and
  both divide-by-zero guards.
- `recurring.test.ts` — a monthly insurance bill is detected; groceries aren't.
- `mutate.test.ts` — book-safety rejection; keep/carry/match amounts.

Page behaviour needs a live database and is verified by hand at both a phone
and a desktop width, as Phases 0–2 were.

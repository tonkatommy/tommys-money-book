# Phase 4a - IR3 pack: design

**Date:** 16/09/2026
**Input:** [implementation-plan.md](../../implementation-plan.md) §6 Phase 4;
[Phase 3c reports design](2026-08-24-phase-3c-reports-design.md).
**Status:** agreed with Tommy, ready to implement.

---

## 1. Scope

The plan's Phase 4 bundles three unrelated things under "Reports and
year-end": the IR3 pack, budget vs actual, and savings goals. Phase 3 was in
the same shape before it got split into 3a/3b/3c, for the same reason — they
don't share a data layer and specifying all three at once means specifying
the two nobody is waiting on yet. This round is the IR3 pack only.

**In scope:**

- FY rental summary for Cashel St: gross income, itemised expenses, the
  mortgage interest/principal split.
- FY business summary for Tommy Tinkers, by tax tag: income, expenses, with
  the `Entertainment` category called out on its own line.
- Home office deduction: the four `HOME_OFFICE`-tagged categories' eligible
  costs, apportioned at 12.57%.
- Other taxable personal income for completeness: salary, the W&I benefit,
  AIA income-protection payments.
- The two figures the Akahu feed cannot see — the Ray White management fee
  and the ASB mortgage interest — entered once a year through a form.
- An `/reports/ir3` screen and an `.xlsx` download.

**Not in scope:**

- **Budget vs actual, savings goals.** Phase 4b/4c. Nothing here blocks
  either — they don't touch tax tags or the FY data layer.
- **Resolving the AIA tax treatment, the entertainment 50% limit, or the
  mortgage-interest figure with Garreth.** These are flagged in
  `definitions.ts` as needing a professional's confirmation before the first
  real filing. This phase surfaces them as caveats on the figures that
  depend on them. It does not decide them, and it must not read as having
  decided them.
- **Emailing or saving the export anywhere.** A download button only.
  Tommy forwards the file to Garreth himself — no new outbound-network or
  filesystem surface on a LAN-only app for one PDF a year.
- **Any UI for editing the category list.** Categories and tax tags stay
  code (`definitions.ts` + `categories:seed`), as everywhere else in the
  app. The two figures this phase does add a form for are not categories —
  they are numbers the bank feed structurally cannot contain.

---

## 2. The two figures Akahu cannot see, and why they need a form, not a rule

Every other number on every other reports screen comes from a transaction.
Two numbers the IR3 needs do not, and no category rule can manufacture them:

- **The Ray White management fee.** Ray White deducts its fee before paying
  the rent out, so the transaction Akahu shows is already net. The IR3
  wants **gross** rental income with the fee as its own deductible expense
  line — two numbers where the bank feed has one, and the difference is a
  fact about Ray White's own statement, not something inferable from
  Cashel St's transaction history no matter how the rules are written.
  `definitions.ts` already has a category built for this — `Rental —
  Management Fees`, empty of baseline transactions on purpose, with a
  comment saying "this is where the Phase 4 gross-up entries land."

- **The ASB mortgage interest/principal split.** The bank feed shows one
  transaction per repayment, and the whole thing currently sits in
  `Rental — Mortgage Payments` tagged `RENTAL_EXPENSE`. Only the interest
  portion is deductible. The split isn't in the transaction at all — it's
  in ASB's annual loan statement, which is issued once a year and which
  Akahu has no channel to.

Both are entered through a plain form, one row per financial year, rather
than a CLi script — this is a number Tommy types once a year off a paper
statement, not a bulk operation over transactions, so it doesn't fit the
`categories:recat`-style dry-run/`--confirm` CLI pattern the rest of the
app's one-off data fixes use. It also isn't a category, a rule, or anything
`categories:seed` pushes from code, so it isn't miscategorised as one.

**The failure mode this section exists to prevent:** a figure silently
computed as if the bank-fed total were the truth. If the management fee
isn't entered for a given FY, gross rental income must not quietly equal
net rental income — it must say so. If the mortgage interest isn't entered,
the deductible expense total must not quietly include the whole repayment
(principal included) — that overstates a deduction, which is the wrong
direction to be wrong in for a document going to IRD. Both cases surface as
an on-screen warning; neither silently produces a plausible number.

---

## 3. Schema

One new model:

```prisma
// The two figures the Akahu feed cannot see, entered once a year.
//
// Ray White nets its management fee before paying rent, so the feed only
// ever shows the net amount — the IR3 needs gross rental income with the fee
// as its own deductible line. The ASB mortgage repayment is one bank-fed
// total covering principal and interest, and only interest is deductible;
// the feed cannot split it, the annual loan statement can. Null means "not
// entered yet" for that FY, and the IR3 screen has to say so loudly rather
// than quietly use the bank-fed total as if it were the deductible figure.
model TaxYearAdjustment {
  fyLabel String @id // "FY2027" — matches FinancialYear.label from reports/fy.ts

  rentalManagementFeeCents    Int?
  rentalMortgageInterestCents Int?

  updatedAt DateTime @updatedAt
}
```

Keyed by the FY label string rather than a numeric id: there is exactly one
row per financial year, it's `upsert`ed whole by the form, and the label is
already the join key every other reports screen hands around (`fy.ts`'s
`FinancialYear.label`). No relation to `Account` or `Category` — this model
describes a fact about a tax year, not about a book.

---

## 4. Data layer

Same three-way split as `src/lib/budget/` and the existing
`src/lib/reports/` files: pure logic, Prisma reads, Prisma writes.

### `src/lib/reports/ir3.ts` — pure, unit-tested, no Prisma

- `HOME_OFFICE_RATE = 0.1257` and `homeOfficeDeductionCents(eligibleCents)`
  — `Math.round(eligibleCents * HOME_OFFICE_RATE)`. Worth stating plainly:
  this is a derived report figure computed from an already-integer total,
  not a value parsed from decimal human input or written back as a
  transaction amount, so it is not the case `dollarsToCents` exists to
  guard against. A second, uncontrolled money *parse* at a form boundary
  would be a bug; a percentage applied once to a cents integer and rounded
  is not.

- Three named constants for the categories the IR3 math has to recognise
  individually, not just by tax tag: `Rental — Mortgage Payments`,
  `Rental — Management Fees`, `Rental Income — Cashel St`. Seven categories
  carry `RENTAL_EXPENSE`; only one of them needs the principal stripped out,
  and there is no tag granular enough to say which without a second tag
  meaning "half-deductible," which would be worse. This is the same kind of
  coupling `rollingBusinessTurnoverCents` already has with its doubled
  `taxTag: "BIZ_INCOME", book: "BUSINESS"` guard, and `definitions.ts`'s own
  comments on these two categories anticipated exactly this — the category
  list is code, and this is one more piece of code reading it by name. If a
  named category is missing or has no transactions for the FY, the function
  returns a warning rather than treating the figure as zero.

- `computeRentalFigures(categories: CategoryTotal[], adjustment):
  RentalFigures` — grosses up income (net rent received + management fee),
  builds the itemised expense list, and computes deductible expense as
  *every `RENTAL_EXPENSE` category's total, minus the non-deductible
  mortgage principal* (`mortgagePaymentsCents - mortgageInterestCents`).
  `warnings: string[]` covers: management fee not entered (income
  understated, expenses understated by the same amount, net unaffected —
  stated as such); mortgage interest not entered (the mortgage category is
  **excluded from the deductible total entirely**, not included at its full
  bank-fed value — treating an unconfirmed number as fully deductible is
  the wrong direction to fail in).

- `computeBusinessFigures(categories: CategoryTotal[]): BusinessFigures` —
  `BIZ_INCOME` and `BIZ_EXPENSE` totals, with `Entertainment` split into its
  own line and a caveat ("NZ commonly limits entertainment deductions to
  50% — confirm the treatment with Garreth before filing"). Never
  auto-halved — that's a decision for Garreth, not a default this code
  picks.

- `computeHomeOfficeFigures(categories: CategoryTotal[]):
  HomeOfficeFigures` — sums the four `HOME_OFFICE` categories (`Home Rent`,
  `Home Power`, `Home Internet & Phone`, `Home Water`), which live in the
  PERSONAL book even though the deduction is claimed against the business —
  `definitions.ts` says so directly, and this function is what makes that
  true: it reads by tag, not by book.

- `computeTaxableIncomeFigures(categories: CategoryTotal[]):
  TaxableIncomeFigures` — the three `TAXABLE_INCOME` categories (`Salary &
  Wages`, `Benefit & Support`, `Income Protection Claims`), with a caveat
  on the AIA line carried over from `definitions.ts`'s existing note (its
  taxable-vs-lump-sum treatment isn't settled either).

All four `compute*` functions take already-fetched `CategoryTotal[]`
(`src/lib/reports/query.ts`'s existing type) rather than a `PrismaClient`,
so every branch, including the missing-adjustment and missing-category
paths, is reachable from a unit test with no database.

### Reads: `src/lib/reports/query.ts`

- `getTaxYearAdjustment(fyLabel): Promise<{rentalManagementFeeCents: number
  | null; rentalMortgageInterestCents: number | null}>` — reads the row;
  defaults both fields to `null` if the FY has no row yet.

- `getIr3Pack(fy: FinancialYear, now?: Date): Promise<Ir3Pack>` — the read
  composer for the screen, in the shape of `getReportsOverview`: runs
  `categoryTotals(PERSONAL, fy.start, rangeEnd)`,
  `categoryTotals(BUSINESS, fy.start, rangeEnd)`, `dataQuality` for both
  books, and `getTaxYearAdjustment(fy.label)` in parallel, then calls the
  four pure functions above.

  **This screen does not take a `?book=` filter.** Every other reports
  screen is one book at a time; an IR3 return is one document covering
  both, because rental and other personal income sit in one book and the
  business summary in the other, and home office spans both by design. This
  is the one deliberate departure from the `?book=` convention in this
  section of the app, and the screen says so in its own copy rather than
  leaving a reader to notice the book toggle does nothing here.

### Writes: `src/lib/reports/mutate.ts` (new file)

- `saveTaxYearAdjustment(fyLabel, {rentalManagementFeeCents,
  rentalMortgageInterestCents}): Promise<MutationResult>` — a Prisma
  `upsert`. Reuses `MutationResult` and `parseDollarsToCents` from
  `src/lib/budget/mutate.ts` — the parser is already a general
  dollars-string-to-cents converter, not budget-specific, and
  `reports/query.ts` already imports budget helpers (`nzDate`, `nzToday`,
  `utcDate`) across the same module boundary. Validates both values are
  `null` or a non-negative integer. No book-safety check applies: the model
  has no book, and nothing about it can cross one.

### `src/app/(app)/reports/ir3/actions.ts`

`saveTaxYearAdjustmentAction` — `"use server"`, `hasSession()` first
(invariant 6, same as every other action in the app), parses the two form
fields, calls `saveTaxYearAdjustment`, `revalidatePath("/reports/ir3")`.
Matches `saveBudgetAction`'s `FormState` shape in
`src/app/(app)/budget/actions.ts` exactly.

---

## 5. Screens

`src/app/(app)/reports/ir3/page.tsx` — server component,
`export const dynamic = "force-dynamic"`, the same composition pattern as
the three existing report pages: parse `?fy=`, capture one
`now = new Date()` for the whole render, call `getIr3Pack(fy, now)`, render
inside `AppShell`.

- `ReportLinks` (`src/app/(app)/reports/parts.tsx`) gains a fourth entry:
  `{ key: "ir3", href: "/reports/ir3", label: "IR3 pack" }`.
- `QualityAlerts` renders for both books, since this screen isn't scoped to
  one.
- Cards, in FY-return order:
  1. **Rental — Cashel St**: gross income, itemised expenses (every
     `RENTAL_EXPENSE` category, the mortgage line annotated with its
     principal/interest split), net.
  2. **Tommy Tinkers**: income by category, expenses by category with
     `Entertainment` broken out, net, and a link back to `/reports` for the
     GST turnover figure rather than repeating it here.
  3. **Home office**: the four eligible categories' total, the 12.57% line
     shown as a formula, the resulting deduction.
  4. **Other taxable income**: salary, benefit, AIA, with the AIA caveat.
  5. **Adjustments**: the two-field form (management fee, mortgage
     interest) for the selected FY, defaulting to whatever is already
     stored or blank. Plain `<form>`, posts to
     `saveTaxYearAdjustmentAction`, works with JavaScript disabled.
- Every warning `computeRentalFigures`/`computeBusinessFigures` returns
  renders as its own `Alert`, in addition to `QualityAlerts` — an IR3
  figure quietly short by an unentered management fee is this app's
  characteristic failure on the one screen an accountant will actually
  read, and it gets the loudest treatment in the app for exactly that
  reason.
- **Download**: a plain link, `<a href="/reports/ir3/export?fy=2027">
  Download IR3 pack (.xlsx)</a>`. A GET link works with JavaScript
  disabled, so this doesn't need to be a Server Action.

`src/app/(app)/reports/ir3/export/route.ts` — GET route handler.
`hasSession()` first, 401 if absent — the export is a read, but it's a read
of the same financial data every Server Action guards, so it gets the same
check rather than relying solely on `src/proxy.ts`'s matcher (invariant 6's
own reasoning: a route is reachable directly, not only through a link
someone clicked). Calls `getIr3Pack`, builds the workbook with
`buildIr3Workbook` (`src/lib/reports/export.ts`, new file — lays the exact
figures already on screen into `exceljs` sheets, one per return section,
with the FY range in the title), returns it with
`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
and `Content-Disposition: attachment; filename="ir3-pack-FY2027.xlsx"`.

**No chart library, still.** This is a document, not a dashboard — tables
and sums, same reasoning as 3c §6.

---

## 6. Dependency

`exceljs` is added to `package.json`. Chosen over `xlsx`/SheetJS for
formatting support (headers, column widths, a title row per sheet) that
matters more here than on any other screen in the app, because this file's
one reader is an accountant, not Tommy. No dependency for this exists yet
— confirmed by reading `package.json` before writing this spec, not
assumed.

---

## 7. Testing

Vitest, no database, per the testing conventions (Phase 3a spec §7,
repeated in every spec since):

- `ir3.test.ts`:
  - `homeOfficeDeductionCents` at a rounding boundary — a total that
    doesn't divide evenly at 12.57%.
  - `computeRentalFigures` with the adjustment present: gross-up and net
    both correct, principal correctly excluded from the deductible total.
  - `computeRentalFigures` with the adjustment absent: both warnings fire,
    and the mortgage category is excluded from the deductible sum rather
    than included at full value.
  - The missing-named-category fallback — `Rental — Mortgage Payments`
    absent or empty for the FY — returns a warning, not a zero treated as
    fact.
  - `computeBusinessFigures` separates `Entertainment` without halving it.
- Any new parsing added to `src/lib/reports/mutate.ts` beyond the reused
  `parseDollarsToCents` gets the same unit-test treatment.

Page and export behaviour are verified by hand against the dev server, at
phone and desktop widths, with JavaScript disabled — as every screen before
it. Specifically for this phase: the figures are reconciled against
`categories:seed --verify`'s tax-tag totals for the same FY, and the rental
section is checked against a real Ray White/ASB statement for at least one
FY before this is trusted for an actual filed return.

---

## 8. Sequencing

Two PRs on `feat/phase-4a-ir3`, split by correctness risk the same way 3c
was:

1. **Schema, `ir3.ts`, the query/mutate additions, and the adjustments
   form.** All of the arithmetic — gross-up, principal/interest split,
   12.57% — and every way this phase can produce a plausible wrong number.
   Reviewable line by line, fully unit-tested, no xlsx yet.
2. **The full `/reports/ir3` screen, the `exceljs` dependency, and the
   export route.** Mostly presentation over a data layer already reviewed
   and tested in PR 1.

When PR 2 lands, update the roadmap/status note in `README.md` and the
Phase 4 entry in `docs/implementation-plan.md` in the same PR, per the
working agreement — naming the AIA, entertainment, and mortgage-interest
items still open for Garreth to confirm, so the README doesn't claim more
certainty than the report itself does.

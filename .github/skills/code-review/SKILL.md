---
name: code-review
description: Review changes to Tommy's Money Book, a personal double-book accounting app over the Akahu bank feed. Use this for every pull request review in this repository. It carries the domain invariants whose violations are silent — book leaks, transfer mis-pairing, float money, overwritten manual categorisations, NZ/UTC date shifts — and lists the deliberate decisions that look like defects but are not.
---

# Reviewing Tommy's Money Book

This app keeps two sets of books (PERSONAL and BUSINESS) over a New Zealand bank
feed, and produces the figures behind a real IR3 tax return. Its characteristic
failure is not a crash. It is a number that is quietly wrong while every total
still balances and nothing complains.

Review with that in mind. A bug here is usually invisible.

## Read the comments before flagging anything

This codebase carries its reasoning in comments, and they are unusually
load-bearing — most non-obvious lines have a comment above them explaining what
was tried, what broke, and why the odd-looking version is correct. Several
things that look like bugs are documented decisions with the trade-off written
out.

Before raising a finding, read the comment above the code and the header comment
at the top of the file. If the comment already addresses your concern, either
drop the finding or engage with the stated reasoning specifically. "This looks
unusual" is not a finding when the file says why it is that way.

## Invariants — a violation of any of these is a serious finding

### 1. Book safety

A category may only ever be attached to a transaction whose account is in the
same book. `src/lib/categories/match.ts` enforces this for the automatic
matcher, and every other write path re-checks it independently.

Flag any new write path that sets `categoryId` without validating the category's
`book` against the transaction's `account.book`. Also flag anything that resolves
a book from user input (a query string, a form field) when the record itself
already determines it — a category id or a transaction id knows its own book, and
trusting the URL over the record is how a personal category ends up rendered and
navigated as business.

Accounts may have `book: null`, meaning "not yet mapped". Those cannot be
categorised at all. Defaulting them to PERSONAL is a book leak.

### 2. Money is integer cents, never floats

Amounts are `Int` cents everywhere. Conversions go through `src/lib/money.ts`.

Flag any `dollars * 100`, `Math.round(x * 100)`, or float arithmetic on money.
`1.005 * 100` is `100.49999999999999` in binary floating point, so the naive
version silently rounds the wrong way; `dollarsToCents` exists for exactly this
and a second conversion at a form boundary reintroduces the bias.

Expenses are stored NEGATIVE and displayed POSITIVE. The flip happens once, at
the query boundary in `src/lib/budget/query.ts`. Flag a second flip in a
component, or a missing one.

### 3. `categorySource = MANUAL` is load-bearing

`categories:apply` skips rows whose `categorySource` is `MANUAL`. That is what
makes a human correction survive every future rule change and every daily sync.

Flag any code path that sets a category by hand without setting
`categorySource = MANUAL`, and any batch operation that could overwrite a MANUAL
row. Without it the next sync silently restores the wrong answer and nothing
looks broken.

### 4. Transfers must be provable, and must net to zero

Money moving between the owner's own accounts is neither income nor an expense.
Treat one as income and the books show money never earned; treat real income as
a transfer and it disappears. Both leave balanced books.

Every stored pair has exactly two legs summing to zero — `checkPairIntegrity`
asserts it. There are three tiers (`src/lib/transfers/detect.ts`):

- **Tier 1** is reciprocal ANZ descriptions where each leg names the other's
  account. Provable, written automatically.
- **Tier 2** is suggested and confirmed by a human. Suggestions marked
  `contested` — one outgoing leg with several plausible counterparts — must
  **never** be auto-confirmed. In this data a standing order repeatedly collides
  with a genuine flatmate payment on the same day for the same amount, and
  netting the wrong one erases real income.
- **Tier 3** is not attempted.

Flag anything that auto-pairs contested suggestions, widens matching to same-day
amount equality, or writes a pair without the zero-sum check.

Pairs that cross the book boundary are OWNER (contribution/drawing), not
TRANSFER — they must not net to zero inside one book.

### 5. Dates: `@db.Date` at UTC midnight, "today" resolved in Pacific/Auckland

`Transaction.date` is a bare date that Postgres returns at UTC midnight. "Today"
is a question about where the user is standing — NZ is 12–13 hours ahead. The
calendar date is resolved in `Pacific/Auckland` first and only then rebuilt as a
UTC-midnight `Date` (`nzToday` in `src/lib/budget/period.ts`).

Flag any use of `new Date()` to derive a period boundary or a "today", and any
date parsed with `new Date(string)` where the string might not be full ISO —
`new Date("2026-02-31")` silently rolls into March.

The pay period runs anchor-day to anchor-day minus one, not calendar months, and
a short month clamps to its last day.

### 6. Server Actions are reachable as direct POSTs

A Server Function can be invoked by a crafted POST, not only through the UI. So:

- Every action re-checks the session (`hasSession()`), even though `src/proxy.ts`
  already covers the route.
- Any list of ids that carries **authority** — which rows to pin, which pairs to
  confirm — must be re-derived server-side, never taken from the form. Taking it
  from the request means taking a list the caller chose.
- "The UI never offers this" is not a guard. Editing a bank-sourced (`AKAHU`)
  transaction's fields is refused in the query itself, not by hiding the form.

Flag any new action missing the session check, or trusting form input for an
authority decision rather than a value.

### 7. A period with no budget rows is not an empty budget

Each category resolves to its most recent `CategoryBudget` row with
`periodStart <= period.start`, so a budget continues until someone changes it.
There is deliberately no roll-forward job. Flag any code that treats a missing
row for the current period as zero.

Carryover applies only when the row belongs to *this* period; re-applying an
inherited carryover compounds it every month.

### 8. Divide-by-zero and empty-set guards

Real data hits these on day one: a zero budget, day 1 of a period (where a
run-rate projection has no rate yet), and the last day (`daysLeft === 0`). Flag
new arithmetic over budgets, paces or projections that lacks the guard.

## Rules and matching

Rule `DESCRIPTION` patterns match the **normalised** description
(`src/lib/categories/normalise.ts`): lower-cased, runs of 3+ digits collapsed to
`#`, card-number suffix stripped. A pattern written against the raw text matches
nothing. Flag patterns containing capitals or literal long digit runs.

Rule specificity is DESCRIPTION > MERCHANT > AKAHU_CATEGORY, and that order is
deliberate. Flag a broad MERCHANT rule that would swallow a more specific case —
"IAG" is three policies and only the landlord one is a deductible rental expense.

## Testing conventions — do not ask for more than this

Tests are Vitest with **no database**. Pure logic is unit-tested; anything
touching Prisma is verified by hand against the dev server. This is deliberate
and stated in the specs (Phase 3a design §7).

**Do not** ask for integration tests against Postgres, a test database, or
mocked Prisma clients. Do ask for a unit test when a change adds pure logic —
period arithmetic, totals, parsing, matching, detection — and especially when it
adds a branch with a money or date consequence.

A good finding here is "this new pure function has a branch nothing covers", not
"this database function is untested".

## Deliberate decisions — do not flag these

- **Dark theme only.** No `prefers-color-scheme`, no light palette. The app
  renders balances in a room at night.
- **Inline styles in components.** Chosen so the design-system primitives stay
  portable against the design project they are pulled from. Only three components
  use a stylesheet.
- **Design tokens keep their original names** (`--surface-card`,
  `--text-primary`) rather than Tailwind's, so CSS pulled from the design project
  applies verbatim and stays diffable.
- **`src/proxy.ts`, not `middleware.ts`.** This Next.js version renamed the file
  convention.
- **No rate limiting or lockout on login.** Single user, LAN/Tailscale only,
  documented in the Phase 3a spec §2.
- **One shared password.** Same reason.
- **NZD only, `en-NZ`, no i18n.**
- **Categories and rules are code** (`definitions.ts` + `categories:seed`), not
  editable from the UI.
- **Some categories have no rules on purpose** — where a rule would have to
  guess, the rows stay in the review queue for a human. `categories:seed --verify`
  reports rules matching nothing.
- **Scripts are CLI-first.** Destructive ones are dry-run by default and require
  `--confirm`.

## Where bugs have actually been found

Weight attention here — these are real defects this codebase has had:

- A form that posts every row on save, reading a field it never renders, and so
  clearing a flag nobody touched.
- A projection using budgeted amounts for bills that had already landed at a
  different figure, understating overspends.
- A page taking its book from the query string rather than from the record.
- React resetting uncontrolled inputs after a form action resolves, so a rejected
  submit blanks the fields that were fine. `defaultValue` alone does not survive
  it; the values must come back from the action.
- A rule pattern short enough to match a payment *reference* containing the
  business name, filing a purchase as capital introduced.

## Tone

Findings should name the concrete failure — the input, the resulting wrong
number, and who would notice. "Consider extracting this" is not useful here.
"This writes a category without MANUAL, so the next sync reverts it" is.

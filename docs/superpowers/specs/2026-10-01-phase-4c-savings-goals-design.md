# Phase 4c - Savings goals: design

**Date:** 01/10/2026
**Input:** [implementation-plan.md](../../implementation-plan.md) §6 Phase 4;
[Phase 2 discovery](../../phase-2-discovery.md) §5b (the bucket accounts);
[Phase 4b budget history design](2026-09-19-phase-4b-budget-history-design.md).
**Status:** agreed with Tommy 01/10/2026 (framing in §1, review decisions in
§10), ready to implement.

---

## 1. Scope

The plan names "savings goals" as a Phase 4 item and defines nothing else
about them. So the first job of this spec is to decide what a goal *is*, and
in this app that decision is mostly about which number a goal measures,
because that decides whether the number can quietly be wrong.

**Agreed 01/10/2026:**

1. **A goal is measured by an account's balance.** One goal points at one
   PERSONAL bank account (in practice an ANZ bucket), and its progress is
   that account's balance as Akahu reports it. Not hand-entered earmarks
   (a number a human typed, which goes stale), and not the sum of
   categorised contributions (which depends on categorisation being right,
   and runs into savings moves being `TRANSFER` kind, which nets to zero by
   design and so is invisible to every existing total).
2. **PERSONAL book only.** Business goals, chiefly putting money aside for
   the income tax bill, drag in tax estimation and are a different problem.
3. **Show only.** A goal reports the contribution it needs per pay period
   and whether the account is keeping pace. It changes no figure on
   `/budget` and adds no write path to `CategoryBudget`.
4. **Tommy already has dedicated savings buckets,** so the design assumes
   accounts exist to point goals at, and needs no "open an account first"
   flow.

**In scope:**

- A `SavingsGoal` table: name, account, target amount, optional target date.
- Create, edit and archive goals through forms.
- `/goals`: every active goal's balance against target, the contribution
  needed per pay period to hit the date, the average actually put in over
  recent periods, and a projection.
- `/goals/[id]`: the same, plus the account's net flow for each of the last
  six complete pay periods.
- Data-quality warnings when the balance behind a goal can't be trusted:
  stale balance, inactive Akahu connection, persistent reconciliation drift,
  or an account no longer in the PERSONAL book.

**Not in scope:**

- **Several goals sharing one account,** i.e. earmarks. See §3 for why this
  is a correctness rule, not a simplification.
- **BUSINESS goals and tax provisioning.** Decision 2.
- **Feeding goals into "safe to spend".** Decision 3. Revisit once there's a
  period or two of real goals to judge whether the number is wanted there.
- **A chart.** The per-period table and a server-rendered progress bar
  answer every question here. Recharts stays on the two 4b routes, per the
  Charts line in `AGENTS.md`.
- **Goals on the cash accounts** (`src/lib/accounts/cash.ts`) or any account
  without an `akahuId`. There is no bank balance to measure.
- **Hard delete.** Goals are archived, not deleted (§5).
- **Interest projection.** A savings bucket earns interest, which shows up
  in the net flow (§4) as the money it is. Projecting future interest would
  be a guess at a rate the app doesn't know.

---

## 2. Why the balance, and which balance

The account balance is the one figure in this app that is checked against
the bank every day. `reconcileAccount` (`src/lib/sync/reconcile.ts`)
compares Akahu's balance with `openingBalanceCents + stored transactions +
pending`, every sync stores that drift, and `isDriftPersistent` turns a
gap that lasts 24 hours into a warning. A goal built on the balance inherits
all of that for free, where a goal built on categorised contributions would
need its own, weaker, check.

Two different figures are used, deliberately, for two different questions:

- **Progress uses `Account.balanceCents`**, Akahu's reported balance. It is
  the number the ANZ app shows, so a goal never disagrees with what Tommy
  sees on his phone. It includes pending authorisations, which on a savings
  bucket are close to always zero.
- **Contributions per period use settled transactions:** the sum of
  `amountCents` for the account with `date` inside the period. That is the
  only way to get a per-period figure, since Akahu reports one current
  balance, not a history of them.

These two agree exactly when the account reconciles. When it doesn't, that
is precisely what the persistent-drift warning says, so the goal shows the
warning (§6) rather than inventing a third definition to paper over it.

Net flow is **category-blind**: every transaction on the account counts,
categorised or not, transfer or not. Standing orders in, interest in,
withdrawals out. That is what "how much did the balance move this period"
means, and it keeps goals entirely clear of invariant 4: nothing here
pairs, nets or reads `Kind`. It also means the invariant 2 expense flip in
`budget/query.ts` does **not** apply. Amounts stay as stored, positive in
and negative out, and nothing in `src/lib/goals/` flips a sign.

---

## 3. One active goal per account

If two goals pointed at the same account, each would claim the whole
balance. $5,000 in one bucket would show as $5,000 toward a holiday *and*
$5,000 toward a car, and the sum of progress across goals would exceed the
money that exists, with every individual figure still matching the bank.
That is this app's characteristic failure exactly, so it is a rule:

- **At most one active (non-archived) goal per account.**
- **The database enforces it**, with a partial unique index on `accountId`
  where `archivedAt` is null (§5). A plain `@unique` would also block
  starting a new goal on an account whose old goal is archived, which is
  the normal life cycle of a bucket.
- **The write path checks too**, but only to produce a friendly form error.
  The check alone isn't a guard. Under Postgres's default `READ COMMITTED`
  isolation, two concurrent creates or unarchives can both read "no active
  goal" and both commit, even inside `$transaction`. Single user makes that
  unlikely (a double-clicked submit is the realistic case), but it is
  exactly the kind of quietly-wrong state this app exists to make
  impossible rather than improbable. The loser of that race gets Prisma's
  `P2002` unique-violation error, which the write path catches and returns
  as the same form error the check gives.
- Neither is the dropdown. Hiding an account from the select is a hint
  (invariant 6).

Earmarks, several goals splitting one account, can come later as their own
phase, if it turns out to be wanted. They need allocation rows that sum to
no more than the balance, and a story for what happens when a withdrawal
takes the balance below the sum of allocations. None of that is needed for
one bucket per goal.

---

## 4. Pace: the arithmetic

All pure, in `src/lib/goals/pace.ts`, unit-tested, no Prisma. Periods are
pay periods from `BudgetSettings.anchorDay`, via `payPeriodFor` and
`previousPeriods` in `src/lib/budget/period.ts`, because standing orders
into the buckets leave the Income Bucket on payday. A calendar-month pace
would split every contribution across two months.

### Remaining and reached

- `remainingCents = targetCents - balanceCents`, and `reached` when that is
  `<= 0`. A reached goal shows the overshoot rather than a negative
  remainder.
- **Negative balance** (an overdrawn bucket): progress displays as 0% with
  the actual negative figure beside it. The bar never draws backwards and
  never hides the number.
- **Progress percentage** is display only: `balance / target`, clamped to
  0–100 for the bar width, with the true percentage in the text when over
  100. `targetCents > 0` is enforced on write (§5), so there is no
  divide-by-zero to guard here, but the function still returns `null` for a
  non-positive target rather than trusting that.

### Periods left and the required contribution

`periodsLeft(today, targetDate, anchorDay)` counts pay periods **from the
current one up to and including the one containing the target date.** The
current period counts, because money can still go in this period.

- Target date in the current period: `1`.
- Target date before today: `0`, which is the **"target date passed"**
  state. No per-period figure is shown, since a required contribution over
  zero periods doesn't exist. The goal says the date has passed and shows
  the remainder.
- `requiredPerPeriodCents = ceil(remainingCents / periodsLeft)`. **Rounded
  up**, so that paying the suggested amount every period actually reaches
  the target. Rounding down leaves the goal a few cents short on the last
  day, which reads as a bug however small it is. This is the branch with a
  money consequence, and it gets a test.
- No target date: no `periodsLeft`, no required figure. The goal shows the
  balance, the target and the projection only.
- Short months and anchors past the 28th are handled by `payPeriodFor`'s
  existing clamping, not re-implemented here. The tests cover an anchor of
  31 across February anyway, because this is a new caller.

"Today" is `nzToday(now)`, with `now` captured once per render, as on every
other screen (invariant 5).

### What is actually being put in

- `averageContributionCents`: the mean net flow (§2) over **up to the last
  six complete pay periods**, `HISTORY_PERIODS` in `budget/query.ts`
  (agreed 01/10/2026). Six rather than the three behind the budget
  suggestions because a bucket topped up irregularly, rather than by a
  standing order, swings too much over three to project from. It also
  means the average is exactly the mean of the rows in the detail page's
  history table (§6), so the projection can be checked by eye against the
  figures printed directly under it.
- **Rounded to whole cents with `Math.round`,** the same rounding as
  `averageSpentCents` in `budget/history.ts`. A mean of integer cents is
  fractional whenever the sum doesn't divide by the period count (10,001
  cents over six periods is 1,666.83...), and an unrounded mean would carry
  float money into the on-track comparison and the projection. Rounded in
  `averageContributionCents` itself, so no caller ever sees the fraction.
- **Only periods that start on or after the account's `historyStartDate`
  count.** The period containing `historyStartDate` is incomplete: whatever
  moved between that period's start and the first imported transaction
  isn't in the data, so it would read as a smaller contribution than was
  made. An account opened two months ago has one or two periods of history,
  not six periods where four are zero. The trade-off is that a genuinely
  new bucket loses its first, partial period from the average. The app
  can't tell "opened mid-period" from "Akahu's history starts mid-period",
  and dropping a real period understates the history, where keeping a
  truncated one misstates it. If no period qualifies, the average is
  `null`, not zero, and not `NaN`.
- The running period is excluded, for the reason 4b gives (spec §2): on
  day 5 the payday standing order may or may not have landed, and a
  partial period reads as a missed contribution.

### Projection

- **On track** when `averageContributionCents >= requiredPerPeriodCents`.
- **Projected reach date**: `ceil(remaining / average)` periods, counting
  the current one as the first (consistent with `periodsLeft`), reported as
  the **last day** of the period the target is reached in. Shown with or
  without a target date. *Amended during implementation, 02/10/2026:* this
  originally said the period's payday, which assumes the period's money
  lands on day one. True for a standing order, not for a top-up, so the end
  date is the claim that holds either way.
- **Horizon:** more than 600 periods (50 years) away is reported as such
  rather than as a date. It also bounds the walk when a few cents of
  interest is the only thing going in, which is exactly BNZ Rapid Save.
- **Average `<= 0`** (withdrawals outpacing deposits, or nothing going in):
  no projected date. The goal says "not growing at the current rate", which
  is the true statement. Dividing by a negative average gives a date in the
  past, and dividing by zero gives `Infinity`, and both have to be stopped
  before they reach the page.
- **Reached** goals show no projection.

---

## 5. Schema and writes

### `SavingsGoal`

```prisma
// A target for one savings account's balance. Progress is the account's
// own Akahu balance, never a figure stored here, so a goal can't drift away
// from the bank. See the Phase 4c spec §2-3.
model SavingsGoal {
  id          String    @id @default(cuid())
  name        String
  accountId   String
  targetCents Int
  targetDate  DateTime? @db.Date // null = no deadline, so no required pace
  note        String?
  archivedAt  DateTime? // set by hand; a reached goal is not auto-archived
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  account Account @relation(fields: [accountId], references: [id])

  // One active goal per account (§3). Partial, so an archived goal doesn't
  // block a new one on the same bucket.
  @@unique([accountId], where: { archivedAt: null })
}
```

The `where` clause needs `previewFeatures = ["partialIndexes"]` on the
generator. It has been in Prisma since 7.4, covers PostgreSQL with
migration and introspection support, and its error strings are present in
the pinned 7.8.0 schema engine. It is a preview feature on a pinned stack,
so the alternative was weighed: hand-writing `CREATE UNIQUE INDEX ... WHERE
"archivedAt" IS NULL` into the migration SQL works, but the schema doesn't
know the index exists, so the next `prisma migrate dev` sees drift and
generates a migration to drop it. A guard that the next unrelated migration
quietly removes is worse than a preview flag. If the flag misbehaves during
implementation, stop and raise it rather than falling back silently.

The unique index also serves lookups by `accountId`, so no separate
`@@index` is needed.

`Account` gains the back-relation `savingsGoals SavingsGoal[]`. No
`onDelete: Cascade`: accounts are never deleted in this app, and if one ever
were, silently taking its goals with it would be the wrong default.

No stored balance, progress or "amount saved" column, on purpose. Any
stored copy of the balance is a second source of truth that goes stale
between syncs.

**Not auto-archived on reaching the target.** A balance can cross the
target, then dip below after a withdrawal. A job that archived on crossing
would hide the goal at exactly the moment it stopped being met. "Reached" is
computed each render, and archiving is a human decision.

### Writes: `src/lib/goals/mutate.ts` and `src/app/(app)/goals/actions.ts`

The same split as budgets and the IR3 form: parsing and validation in the
plain module so it is unit-testable without a request context, and the
`"use server"` actions as thin wrappers.

- `parseGoalForm(formData, today, mode)` returns the parsed goal or field
  errors. `mode` is `"create"` or `"edit"`, and it is **passed by the
  action, never read from the form.** Create and edit are separate actions,
  each of which knows which it is. A hidden `mode` field would let a direct
  POST claim to be an edit and slip a past date past the create-only rule.
  The fields:
  - `name`: trimmed, non-empty, 80 characters at most.
  - `targetCents`: through `parseDollarsToCents`, and must be `> 0`.
  - `targetDate`: optional. When present, through `parseDateParam`
    (`src/lib/transactions/query.ts`) so `2027-02-31` is rejected rather
    than rolled into March. On **create** it must be after `today`. On
    **edit** a past date is allowed, so a goal that missed its date can be
    kept and re-dated rather than refused.
  - `note`: optional, trimmed.
- `createGoal`, `updateGoal`, `setGoalArchived`, each in one
  `prisma.$transaction`. When a write **makes a goal active on an account**,
  which means creating, editing (whether or not the account changed), or
  unarchiving, the transaction:
  - **re-reads the account and re-checks it**: exists, `book ===
    "PERSONAL"` (not null, which means unmapped, and not BUSINESS), and has
    an `akahuId`. The account id from the form is a value naming a record,
    and the record decides its own book (code-review skill §1), never the
    form;
  - checks no **other** active goal uses the account (§3), and catches
    `P2002` from the partial unique index as the same error.
- **Archiving skips both checks.** It takes a goal *out* of tracking, so it
  can't create a clash or a book leak. It also has to work on exactly the
  goals that fail the account check: §6 keeps a goal visible, with a
  warning, when its account moves to BUSINESS, and archiving is how Tommy
  clears it. Refusing that would leave a goal that can neither be tracked
  nor put away. Archiving still checks the session and that the goal
  exists.
- Editing re-checks the account even when it didn't change. A goal whose
  account has since moved books can't be edited back into being tracked;
  it can only be archived.
- *Added during implementation, 02/10/2026:* **an archived goal can't be
  edited** until it is unarchived. Unarchiving is where its account is
  re-checked; editing it while archived would have to either skip that
  check or clash with whichever goal has since taken over the bucket.
- Every action re-checks `hasSession()` first (invariant 6).
- Errors are returned, not thrown, in the `MutationResult` shape, and the
  submitted values come back from the action so a rejected save doesn't
  blank the good fields (the bug listed under "where bugs have actually been
  found").

---

## 6. Reads and screens

### Reads: `src/lib/goals/query.ts`

- `getGoals(now)`: every goal with its account, in one query. Then, in
  parallel, per account, net flow for the `HISTORY_PERIODS` complete
  periods behind the average (`groupBy` is not needed; one `aggregate`
  `_sum` per period per account, at a handful of goals). Plus the account's
  last 20 `AccountSyncResult` rows for `isDriftPersistent`, the same depth
  `getSyncStatus` reads.
- `getGoalDetail(id, now)`: the same for one goal, returning the
  per-period rows themselves for the history table. Same window, same
  reads: the table and the average are one array, not two queries.
- `getGoalAccountOptions()`: every PERSONAL account with an `akahuId`, for
  the form's select, each flagged if it already has an active goal. **Not
  filtered by `accountType`** (agreed 01/10/2026): Tommy picks the account,
  since he knows which buckets are savings and the app doesn't. The flag is
  a hint for the form. §5 is the guard.

### Warnings on a goal

A goal is only as good as the balance under it, so each goal carries its
own data-quality line, worded for that goal, rather than sending Tommy to
`/sync` to work out whether it applies:

| Condition | Message gist | Source |
|---|---|---|
| Account `status === "INACTIVE"` | Bank connection needs re-consent; balance frozen | `Account.status` |
| `balanceAsAt` older than `STALE_AFTER_HOURS` | Balance last updated DD/MM/YYYY | `isSyncStale` in `sync/stale.ts` |
| `balanceAsAt === null`, balance present | Balance date unknown; can't tell how current it is | `isSyncStale` |
| Persistent drift | Contributions below may be missing transactions | `isDriftPersistent` |
| Account `book !== "PERSONAL"` | Account has moved books; goal not tracked | `Account.book` |
| `balanceCents === null` | No balance from the bank yet | `Account.balanceCents` |

The null-date row is there because `normaliseAccount`
(`src/lib/akahu/normalise.ts`) sets `balanceCents` and `balanceAsAt`
independently, from `balance.current` and `refreshed.balance`, so a balance
can arrive with no date. `isSyncStale` already treats `null` as stale (the
first-boot case it was written for), so the goal calls it with
`balanceAsAt` directly, rather than `hoursSince`, which would need a
non-null date. One definition of stale, and an undated balance is never
presented as current.

The last two **still show the goal**, with the warning in place of the
figures, rather than dropping it from the list. A goal that silently
disappears because its account was remapped is a goal nobody notices has
stopped being tracked.

### `/goals` (new)

`src/app/(app)/goals/page.tsx`, `export const dynamic = "force-dynamic"`,
one `now` for the render. Server component, no `?book=` toggle (PERSONAL
only, and saying so in the heading).

One card per active goal, ordered by target date (soonest first), then
undated goals by name:

- name, account name, and the balance's as-at date;
- balance / target, and a progress bar as a server-rendered `div` width;
- remaining, or "reached" with the overshoot;
- with a date: periods left, required per period, on track or not;
- average put in over the last N periods, saying N;
- projected reach date, or "not growing at the current rate";
- any warnings (above);
- link to the detail page.

Archived goals sit in a collapsed `<details>` underneath. It works with no
JavaScript, and they stay findable without cluttering the active list.

**First run** (no goals): a line saying what a goal is, measured from a
savings account's balance, and a link to `/goals/new`.

### `/goals/new` and `/goals/[id]`

- `/goals/new`: the form. Account `<select>`, name, target, optional date,
  note. Accounts that already have an active goal are listed but marked,
  so it is clear why picking one will be refused.
- `/goals/[id]`: the card above, then a **history table**, one row per
  complete pay period for the last six: period label, net flow in, and
  closing balance. The closing balance is `openingBalanceCents` plus settled
  transactions up to the period end, and is shown only when
  `openingBalanceCents` is known. Then the edit form and an Archive (or
  Unarchive) button, each its own `<form>`.

### Navigation

**No new nav item** (agreed 01/10/2026). The bottom bar already carries
seven items at phone width (`src/components/ui/nav.tsx`), and an eighth
would squeeze every label. A "Goals" link sits on the `/budget` head beside
"History" instead, since that is where Tommy is already looking when he
thinks about this period's money.

---

## 7. Invariants touched, and how

| # | Invariant | Here |
|---|---|---|
| 1 | Book safety | Goal account re-checked as PERSONAL on every write that makes a goal active (archiving excepted, §5). A goal whose account later moves books shows a warning, and is not silently dropped or counted. |
| 2 | Integer cents | Target via `parseDollarsToCents`. All arithmetic in cents: `ceil` for the required contribution, `Math.round` for the average, never `* 100`. No expense flip (§2). |
| 3 | MANUAL | Not touched. Goals never write `categoryId`. |
| 4 | Transfers | Not touched. Net flow is category- and pair-blind (§2). |
| 5 | Dates | `targetDate` is `@db.Date`, parsed by `parseDateParam`, compared against `nzToday`. |
| 6 | Server Actions | `hasSession()` on every action. Account book and the one-goal rule re-derived from the database, the latter enforced by a partial unique index. Create/edit `mode` comes from the action, not the form. |
| 7 | Missing rows ≠ zero | Only periods starting on or after `historyStartDate` count toward the average, so a truncated first period doesn't either. No history means a `null` average, never zero. |
| 8 | Divide-by-zero | `periodsLeft === 0`, average `<= 0`, no history, non-positive target. All tested. |

---

## 8. Testing

Vitest, no database, as every spec since 3a §7.

- `pace.test.ts`:
  - `periodsLeft`: target in the current period is 1; on the last day of
    the current period is 1; the day after it is 2; in the past is 0; an
    anchor of 31 across February; the year boundary.
  - `requiredPerPeriodCents`: rounds **up** (`$100.00` over 3 periods is
    `3334`, not `3333`); exact division unchanged; `periodsLeft === 0` is
    `null`; reached is `0` or `null`, not negative.
  - `averageContributionCents`: six periods; a sum that doesn't divide
    (10,001 over six) comes back as a whole number of cents; the period
    containing `historyStartDate` is excluded when it starts before it, and
    included when `historyStartDate` is exactly its start; none qualifying
    is `null`; a withdrawal period pulls the average down rather than being
    ignored.
  - `projection`: a positive average gives a payday date; a zero or
    negative average is `null`; reached is `null`.
  - `progress`: negative balance clamps the bar and keeps the figure; over
    100%; non-positive target returns `null`.
- `mutate.test.ts` (goals): `parseGoalForm` with a blank name, a zero or
  negative target, `2027-02-31`, a past date on create (refused) and on
  edit (allowed), the same past date refused when `mode` is `"create"`
  even if the form carries a field claiming otherwise, and values echoed
  back on failure.
- A goal-warning helper, if the warning rules are pulled into a pure
  function as `sync/status.ts` does for the status page: a null
  `balanceAsAt` with a balance present warns as stale.

The account checks and the one-active-goal rule touch Prisma, and are
verified by hand against the dev server: a BUSINESS account id posted
directly, an unmapped account, a cash account, a second goal on a busy
account, and unarchiving into a clash. Each must come back as a form error.
The index itself is checked by inserting a second active goal on the same
account in `psql` (refused) and a second archived one (allowed). An active
goal on an account remapped to BUSINESS must still archive.
Screens are checked at phone and desktop widths with JavaScript disabled.

---

## 9. Sequencing

**One implementation PR**, `feat/phase-4c-savings-goals`. 4b split in two
because one PR refactored a function every `/budget` figure depends on.
Nothing here changes an existing figure. It is a new table, a new pure
module and new routes, so a single PR is reviewable as a unit:

1. Schema and migration, with the `partialIndexes` preview flag. Read the
   generated SQL to confirm it carries `WHERE "archivedAt" IS NULL` before
   going further.
2. `src/lib/goals/pace.ts` and its tests.
3. `mutate.ts`, the actions, and `/goals/new`.
4. `query.ts`, `/goals` and `/goals/[id]`.
5. The `/budget` link, then the docs: roadmap and status in `README.md`,
   and the Phase 4 entry in `docs/implementation-plan.md`, in the same PR
   per the working agreement.

---

## 10. Review decisions (01/10/2026)

1. **No nav item.** A link from `/budget` only (§6).
2. **Tommy chooses the account.** Any PERSONAL account with an `akahuId`
   is offered, unfiltered by `accountType` (§6). Nobody has checked what
   type Akahu reports for an ANZ bucket, and a filter built on a guess
   could hide the very account a goal was meant for. The guards in §5
   (book, `akahuId`, one active goal) still apply whatever is picked.
3. **Six periods for the average,** `HISTORY_PERIODS` (§4).

For hand verification, pick at least one bucket fed by a standing order,
so the average has something steady to measure, and ideally one with a
withdrawal inside the six-period window.

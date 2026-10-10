# Tommy's Money Book

A self-hosted personal finance app for New Zealand, built to replace a
long-suffering Excel expense tracker. It pulls bank transactions automatically
via the [Akahu](https://www.akahu.nz) open banking API, keeps personal and
sole-trader business books strictly separate, and produces the numbers needed
for NZ tax time (IR3 rental and business income, GST threshold monitoring).

Runs on a homelab. Single user. LAN/Tailscale only — nothing exposed to the
internet.

**Using the app rather than building it?** Go straight to the
[User guide](#user-guide).

## Why

Spreadsheets work until they don't. Manual CSV downloads from two banks,
hand-categorised transactions, formulas that silently break, and a file that
lives one sync conflict away from corruption. This app replaces all of that
with:

- **Automatic daily bank feeds** — Akahu connects ANZ and BNZ under one profile
  and syncs transactions every morning. No CSVs, ever.
- **Two sets of books, one database** — every account and category belongs to
  either the personal or business book, enforced at the schema level rather than
  by discipline.
- **Transfers that net to zero** — movements between own accounts are
  first-class linked pairs, never counted as income or expenses.
- **Tax-aware categories** — categories carry tax tags (rental income/expense,
  business income/expense, home office) so year-end reports don't depend on what
  the categories are named.

It's also a deliberate portfolio project: a real production deployment of the
stack I work in.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router) — UI and API routes in one codebase |
| Database | PostgreSQL |
| ORM | Prisma — schema-as-code, typed client, migrations |
| Bank feeds | Akahu personal app (read-only, free tier, daily refresh) |
| Sync | Scheduled worker (node-cron) polling Akahu, deduping on transaction ID |
| Charts | Recharts for the budget trend only; breakdowns stay server-rendered bar tables (reasoning in the plan) |
| Deployment | Docker Compose on a homelab, nightly `pg_dump` backups |

## Architecture

```text
┌─ Homelab (Docker Compose) ─────────────────────────┐
│                                                    │
│  ┌────────────┐   ┌─────────────┐   ┌────────────┐ │
│  │  Next.js   │──▶│ PostgreSQL  │◀──│ Sync worker│─┼──▶ Akahu API
│  │ (UI + API) │   │             │   │  (cron)    │ │
│  └────────────┘   └─────────────┘   └────────────┘ │
│                        │                           │
│                   nightly pg_dump ──▶ backup vol   │
└────────────────────────────────────────────────────┘
        ▲  LAN / Tailscale only — no port forwarding
```

Design decisions worth noting:

- **Money is integer cents.** Floats can't represent $0.10 exactly; sums drift.
  `-$200.00` is stored as `-20000` and formatted at the edge.
- **Akahu is the sole ingestion path.** On first connection the app pulls all
  available history as its baseline; the old spreadsheet is frozen as an
  archive, not migrated.
- **`externalId` dedupe** means a re-run sync can never double-import a
  transaction. It's enforced by a unique constraint, so the database refuses
  duplicates regardless of what the application believes.
- **Categorisation is rules, not hand-sorting.** Bank descriptions carry a
  per-transaction reference that makes every row unique; normalising them away
  collapsed 1,786 uncategorised transactions to 184 distinct patterns. ~140
  rules now categorise 82% of the baseline automatically.
- **A human decision is never overwritten.** `categorySource` marks whether a
  category came from a rule or a person. The matcher skips the second kind, so a
  correction survives every rule change and every daily sync — otherwise the
  sync would quietly restore precisely the answer that was wrong, and the books
  would still balance.
- **Reconciliation needs an opening balance.** Akahu only reaches back about a
  year (to 16/07/2025 for these banks, against the two the plan hoped for), so
  "sum of stored transactions equals the bank balance" can never hold on its
  own. The balance that predates our earliest transaction is derived once
  at baseline; drift is measured against that from then on.
- **And it needs pending transactions.** The bank's reported balance includes
  card authorisations that haven't settled; the transaction feed contains only
  settled rows. Comparing one against the other gives permanent drift on any
  account with live card activity — so pending totals are fetched and
  subtracted. The pending rows themselves are never imported: their ids are
  unstable and their amounts change on settlement, which would poison
  `externalId` dedupe.
- **The incremental sync window looks backwards.** Each run re-reads the last
  seven days rather than starting where the previous run finished — banks post
  transactions late, and anchoring on run time would skip them permanently.
  Dedupe makes the overlap free.
- **NZ financial year (01/04–31/03) is derived from the transaction date**, not
  stored. The bounds are computed in TypeScript (`src/lib/reports/fy.ts`) and
  filtered on, rather than as the SQL expression the plan first called for:
  the pay period already solves the identical problem that way, and the result
  is unit-testable without a database.
- **A savings goal stores no progress.** Progress is the account's own Akahu
  balance, the one figure reconciled against the bank every day, so a goal
  can't drift from the bank. A partial unique index allows one active goal
  per account: two goals on one bucket would each count the whole balance,
  and every figure would still match the bank.

## Roadmap

Full architecture, data model, and phase detail: [docs/implementation-plan.md](docs/implementation-plan.md).

- [x] **Phase 0 — Scaffolding:** Next.js + Prisma + Postgres in Docker Compose,
      "hello database" on the homelab
- [x] **Phase 1 — Bank feeds:** Akahu connection, full-history baseline pull,
      daily sync worker, balance reconciliation
- [x] **Phase 2 — Categories:** category list built bottom-up from real data,
      rule-based auto-categorisation, transfer pair detection, bulk
      re-categorisation tools
- [x] **Phase 3 — MVP:** transaction list with filtering/search/edit, the
      pay-period budget, and a `/reports` section (FY income/expenses per book,
      category breakdown, month-by-month, GST threshold) — go-live point
- [x] **Phase 4a — IR3 pack:** `/reports/ir3` — FY rental and business
      summaries by tax tag, the 12.57% home office deduction, and an `.xlsx`
      export, plus a form for the two figures the bank feed can't see (the
      management fee and the mortgage interest)
- [x] **Phase 4b — Budget history:** `/budget/history` — six complete pay
      periods of budget vs actual, per-category consistency, and adjustment
      hints, with a trend chart layered over the table
- [x] **Phase 4c — Savings goals:** `/goals` — each goal tracks one
      personal savings account's bank balance against a target, with the
      contribution needed per pay period, the six-period average actually
      put in, and a projected date

## Getting started

No Akahu tokens are needed to run this. The app ships with fixture data — two
years of fake transactions across a fake ANZ and BNZ account — and defaults to
using it, so the whole sync pipeline works out of the box.

```bash
git clone https://github.com/tonkatommy/tommys-money-book.git
cd tommys-money-book
cp .env.example .env    # set a real POSTGRES_PASSWORD
npm install
docker compose up -d db
npm run db:migrate
```

Then pull the baseline and assign each account to a set of books:

```bash
npm run sync:baseline
```

```bash
npm run accounts:map -- "BNZ Tommy Tinkers" BUSINESS
```

`npm run dev` serves the sync status page at <http://localhost:3000>.

Then build the category list and pair up the transfers:

```bash
npm run categories:seed -- --verify
```

```bash
npm run transfers:detect -- --confirm
```

```bash
npm run categories:apply -- --confirm
```

### Commands

#### Syncing

| Command | What it does |
| --- | --- |
| `npm run akahu:probe` | Read-only: which accounts Akahu sees, and how far back each bank's history reaches. Writes nothing. |
| `npm run sync:baseline` | One-off full-history pull. Safe to re-run — dedupe means a second run imports nothing. |
| `npm run sync:daily` | One incremental sync. Same code path the worker runs. |
| `npm run accounts:map` | List accounts, or assign one to PERSONAL / BUSINESS. |

#### Categories

| Command | What it does |
| --- | --- |
| `npm run categories:discover` | Read-only. What the money actually does: enrichment coverage, merchants and Akahu categories ranked by count and volume, and the normalised description keys with how many rules it would take to cover them. Where any re-shaping of the list starts. |
| `npm run categories:seed` | Push `src/lib/categories/definitions.ts` into the database. Idempotent. Add `--verify` for rule coverage, book consistency, tax-tag totals and the GST turnover figure. |
| `npm run categories:apply` | Run the rules. Dry by default; `--confirm` writes. Skips anything categorised by hand. |
| `npm run categories:review` | What the rules couldn't decide, grouped by normalised key — one line per decision, not one per transaction. |
| `npm run categories:recat` | Bulk move. `--from`/`--match`/`--book`/`--account`/`--direction` select, `--to` sets, `--confirm` writes. Marks rows MANUAL so the matcher won't undo them. |

#### Transfers

| Command | What it does |
| --- | --- |
| `npm run transfers:detect` | Pairs ANZ internal transfers automatically (deterministic — both legs name each other), lists everything else as suggestions. `--confirm` writes the automatic tier. |
| `npm run transfers:confirm` | Confirm a suggestion: `--out <id> --in <id>`, or `--confidence HIGH` for every uncontested one at that level. |

#### Backup commands

| Command | What it does |
| --- | --- |
| `npm run db:backup` | Take one now. The nightly job runs the same script. |
| `npm run db:backup:verify` | Restore the newest dump into a scratch database, count the rows, drop it. Never touches the live database. |
| `npm run db:backup:list` | What's currently retained. |

#### Checks

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests: money, normalisation, sync window, reconciliation, rule matching, transfer pairing. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |

#### Fixing a category that's wrong

Two routes, and the difference matters:

```bash
npm run categories:recat -- --match "gas helensvi" --to "Vehicle — Fuel" --confirm
```

moves those transactions once and marks them `MANUAL`, so nothing will ever
re-categorise them. Good for one-offs and for things no rule could infer.

For anything recurring, add the rule to `src/lib/categories/definitions.ts`
instead, then re-seed and re-apply — that way future synced transactions are
categorised too, rather than arriving in the review queue every month.

### Going live with real Akahu data

1. Create a profile at [my.akahu.nz](https://my.akahu.nz), connect the bank
   logins, complete ID verification and 2FA, then create a personal app.
2. Put the two tokens in `.env` (gitignored) and set `AKAHU_MODE=live`.
3. Run `npm run akahu:probe` first — it's read-only, so it confirms the tokens
   work and shows what a baseline would import before anything is written.
4. `npm run sync:baseline`, then `docker compose up -d --build` to start the
   daily worker.

### Full stack

```bash
docker compose up -d --build
```

Three services: the Next.js app on :3000, Postgres, and the sync worker
(no exposed port — it only talks to Postgres and Akahu). Migrations are never
run automatically; apply them with `npm run db:migrate`.

## User guide

How to use the running app day to day. The setup steps above get it running;
this section covers everything after that.

### What it can and cannot do

**It can:**

- Pull every transaction from the connected ANZ and BNZ accounts through
  Akahu, once a day at 7am NZ time, with no CSV downloads.
- Check each account against the bank's own balance every day and flag any
  difference.
- Keep two sets of books, **Personal** and **Business** (Tommy Tinkers), that
  never mix.
- Categorise most transactions automatically with rules, and let you correct
  the rest by hand. A hand correction is never overwritten.
- Run a budget on the pay period (20th to 19th by default). It shows what is
  safe to spend today, whether you are ahead of or behind pace, and which
  bills haven't come out yet.
- Close each period with a one-click decision per category: keep, carry or
  match.
- Show how the last six complete pay periods went against budget.
- Pair up money moved between your own accounts, so it never counts as
  income or spending.
- Record cash spending the bank never saw.
- Report the NZ financial year (01/04 to 31/03) per book: by category, month
  by month, plus a live GST registration monitor.
- Build the IR3 pack (rental, business, other income and home office figures)
  and export it as an `.xlsx` for your accountant.
- Track savings goals against a savings account's real bank balance.
- Work on a phone or a desktop, and work with JavaScript turned off.

**It cannot, by design or not yet:**

| You might expect to… | What actually happens |
| --- | --- |
| Start a sync from the browser | The **Sync** button opens the status page. It doesn't fetch anything. Syncs run on the worker's schedule, or from the command line (see [Run a sync right now](#run-a-sync-right-now)). |
| Edit a bank transaction's date, amount or description | You can't. Those are the bank's record. You can change the category and add notes. Only cash entries you typed yourself are fully editable. |
| Delete a transaction | There is no delete, for bank rows or cash entries. |
| Split one transaction across two categories | Not supported. One transaction, one category. |
| Add, rename or delete categories and rules in the app | Categories and rules are code, in `src/lib/categories/definitions.ts`, loaded with `npm run categories:seed`. |
| Assign an account to a book in the app | It's a command: `npm run accounts:map`. Until that runs, an unmapped account's transactions can't be categorised. |
| Confirm every transfer suggestion from the Transfers screen | Only the uncontested ones. Contested pairs are deliberately CLI-only (see [Transfers to confirm](#transfers-to-confirm-transfers)). |
| Bulk-apply an income or transfer category | The bulk bar on Transactions only offers expense categories. Set income categories one row at a time from the transaction's own page. |
| See pending card transactions | Only settled transactions are imported. Pending ones show as a total on Sync status and nowhere else. |
| See anything before 16/07/2025 | Akahu's history for these banks only goes back that far. Earlier years are in the old Excel tracker. |
| Set a savings goal on the business book, or one goal across several accounts | Goals are personal only, one account each, and one active goal per account. |
| File the IR3, run a GST return, or get tax advice | It prepares the figures and lists the open questions. Filing, and the judgement calls, stay with you and your accountant. |
| Reach it from the internet, or give someone their own login | It's single user and LAN/Tailscale only, with one shared password. |
| Use a light theme | There is only a dark theme. |

### Getting in

1. **Open it.** On the home network, browse to `http://<homelab-host>:3000`.
   Away from home, connect to Tailscale first and use the machine's Tailscale
   name or IP with the same port. On a dev machine it's
   <http://localhost:3000>. Phones use the same address.
2. **Sign in.** The password is whatever `APP_PASSWORD` is set to in `.env`
   (or the `APP_PASSWORD_FILE` secret). There's no username. A wrong password
   says "Incorrect password." and there's no lockout. If you were sent to the
   login page from a bookmark, you land back on that page after signing in.
3. **Staying signed in.** A session lasts 30 days on each device. **Sign out**
   is at the top right at every screen width. Use it on a phone you might
   lose.

If the login page says "Login is unavailable. Check server logs.",
`APP_PASSWORD` or `SESSION_SECRET` isn't set for the app container.

### Finding your way around

On a desktop the menu is a sidebar on the left. Below 768px wide it becomes a
tab bar along the bottom, with shorter labels:

| Sidebar | Tab bar | Goes to | For |
| --- | --- | --- | --- |
| Budget | Budget | `/budget` | The home screen: am I alright this pay period? |
| Transactions | Txns | `/transactions` | Every transaction, filters, categorising, cash entries |
| Transfers | Pairs | `/transfers` | Moves between your own accounts, waiting to be confirmed |
| Reports | Reports | `/reports` | Financial-year figures, GST monitor, IR3 pack |
| Set budget | Set up | `/budget/setup` | Budget amounts, fixed bills, payday |
| Month end | Close | `/budget/review` | Close last period and set this one |
| Sync status | Sync | `/sync` | Is the bank feed still arriving? |

Two screens have no menu item. They're linked from the Budget screen instead:
**How past periods went** (`/budget/history`) and **Savings goals**
(`/goals`).

The header on every screen shows:

- **Pay period**: the current period, say "20 Sep – 19 Oct", and the days
  until payday.
- **Personal / Business**: the book toggle. Switching keeps you on the same
  screen. The choice lives in the address (`?book=BUSINESS`), so you can
  bookmark a business view and the back button works as expected. A few
  screens have a fixed book and show a plain label instead: a category's
  detail page, savings goals (personal only) and the IR3 pack (both books at
  once).
- **Sync** (desktop only) and **Sign out**.

### Words this app uses

Plain-English definitions for the accounting terms that come up.

| Term | Meaning here |
| --- | --- |
| **Book** | A separate set of accounts. Personal is your own money, Business is Tommy Tinkers. Every account and category belongs to exactly one book. |
| **Category** | What a transaction was for: Groceries, Vehicle — Fuel, and so on. Each one is an expense, income, transfer or owner category. |
| **Tax tag** | A label on a category saying which line of the tax return it feeds: rental income, business expense, home office, and so on. The reports go by tag rather than by category name. |
| **Transfer** | Money moved between two of your own accounts *in the same book*. Both legs are linked as a pair and net to zero, so it's neither income nor spending. |
| **Owner** | Money moved *between the books*, for example personal money paid into the business account. To the business that's owner's funds or drawings, not a transfer. |
| **Fixed bill** | A budget line with a due day, such as rent or insurance. It's held aside in full until it comes out, rather than paced day by day. |
| **Everyday (flexible) category** | A budget line you spend gradually, such as groceries. It's measured against pace. |
| **Pace** | How much of a budget you'd expect to have used by today if you spent evenly across the period. |
| **Reconciliation / drift** | Checking that the transactions held add up to the bank's own balance. *Drift* is the difference. Zero is good. |
| **Pending** | Card payments the bank has authorised but not yet settled. They're in the bank's balance but not in the feed yet. |
| **FY** | The NZ financial (tax) year, 01/04 to 31/03. FY2027 is 01/04/2026 to 31/03/2027. |
| **GST threshold** | If business turnover goes over $60,000 in any 12 months, you have to register for GST. |
| **IR3** | The individual income tax return for people with income other than salary, such as rent or a sole-trader business. |

### Two calendars, on purpose

The budget screens run on **pay periods** (20th to 19th) because they answer
"how much until payday?". The reports run on the **financial year** and
**calendar months** because IRD says so. The two never line up, so August on
the Budget screen isn't the same August as in Reports. Every report figure
prints its exact date range next to it. Check that range before quoting a
number.

### The screens

#### Budget (`/budget`)

The daily check. Before any budget exists it shows a **first-run** screen
with your average spend per category over the last three pay periods. Choose
to build the budget from those averages and it opens Set budget with every
figure filled in. Nothing is saved until you press Save.

Once a budget exists:

- **Safe to spend today** is money in the bank, minus bills that haven't come
  out yet, minus everyday budgets you haven't touched. Under it is the same
  figure per day until payday.
- **Ahead / behind pace**: everyday spending so far against a mark showing
  where even spending would have you today, plus "if you carry on at this
  rate", a projection to the end of the period.
- **Everyday categories** are listed worst pace first. "Spent · not budgeted"
  means there's spending but no budget yet. Tap a category for its detail
  page: the daily spending pattern, its transactions, and a trend chart.
- **Bills still to hit** lists unpaid fixed bills by due date. "Estimate"
  means the amount is a guess from past bills.
- Two warnings can appear at the top. Read them first, because both mean
  every figure is understated:
  - *N transactions have no category*, with a link to fix them.
  - *N accounts are not assigned to a set of books*: run
    `npm run accounts:map`.

At the bottom: next payday, **How past periods went**, and (personal book
only) **Savings goals**.

#### Set budget (`/budget/setup`)

- One amount per category, saved together with a single **Save**.
- Tick **fixed** and give a due day for bills. **Pin all N bills** fills
  these in from bills the app has noticed recurring.
- **Pay cycle**: the day of the month payday lands on, which starts each
  period, and **Show half a period at a time**. Paid monthly but find a
  month's money hard to pace? That option halves what Safe to spend shows,
  so you see one fortnight at a time. It's display only: no stored figure
  changes.

A budget carries forward. A category without a new figure this period uses
its most recent one, so you only change what changes.

#### Month end (`/budget/review`)

Last period, category by category, with one decision each:

- **Keep**: the same budget again.
- **Carry**: the same budget plus what you underspent, or minus what you
  overspent ("Repay"), for this period only.
- **Match**: set the budget to what you actually spent.

Decisions apply to the current period. Last period's figures are never
rewritten, so you can reopen the review and still see what was budgeted at
the time.

#### How past periods went (`/budget/history`)

The last six *complete* pay periods against budget, with the running one left
out. Halfway through a period everything looks under budget, which tells you
nothing. It shows which categories run over every time and which are padded,
with an adjustment hint where the pattern is consistent. The chart needs
JavaScript, but the table under it holds every number.

#### Transactions (`/transactions`)

- **Default view**: the current pay period. Each row shows what it did to the
  budget, for example "$108.60 left in Groceries".
- **Filter**: search payee or description, account, category, a from/to date
  range, and **Needs a category**. Filters live in the address, so a filtered
  view can be bookmarked. With a custom date range the "left in…" figures are
  hidden, because they only mean something within a pay period.
- **Badges**: *cash* (you typed it in), *transfer* (part of a confirmed pair),
  *Needs a category*.
- **Bulk categorise**: tick rows, pick a category in the bar at the bottom,
  then **Apply to N selected**. Choosing "clear the category" removes it.
- **Tap a row** for its detail page:
  - *What the bank says*: the facts, read-only for bank rows. It also shows
    what Akahu called it and who decided the category: you, a rule, or a
    confirmed transfer.
  - *Category*: change it here. Saving marks the row as decided by hand, so
    no rule or sync will ever change it back.
  - *Notes*: anything the bank's description doesn't say, such as which job
    it was for or who to split it with.
  - *Entry*: cash entries only. Edit date, description, payee and amount.
- **Add cash entry**: choose the book, date, description, amount and
  direction (in or out), plus an optional category. It's saved to that
  book's Cash account. The category must belong to the book you chose, and
  a mismatch is refused.

#### Transfers to confirm (`/transfers`)

The Transfers screen (`/transfers`) lists suggested pairs that need a human.
Pairs the app can prove, such as ANZ transfers where each side names the
other account, are confirmed automatically during the sync and never appear
here.

- **High / Medium / Low confidence** groups are *uncontested*: each outgoing
  payment has exactly one possible match. One button confirms the whole
  group.
- **Contested** pairs have no button on purpose. One outgoing payment has two
  or more possible matches on the same day for the same amount. A standing
  order and a flatmate's payment are the classic case, and picking the wrong
  one would quietly erase real income. Run `npm run transfers:detect` to see
  them. It prints the exact `transfers:confirm` command for each one, which
  you run after checking it.
- **Owner, not transfer** marks a pair that crosses books. It's money between
  you and the business, not a transfer.

An unconfirmed transfer is being counted as income on one side and spending
on the other, so clear this queue regularly.

#### Reports (`/reports`)

Per book, per financial year. Pick the year with the selector.

- **Reports** (index): money in, money out and net for the FY, plus the **GST
  registration monitor**, which compares business sales over the last 12
  months against the $60,000 threshold.
- **By category**: income and expenses ranked separately, with each one's
  share.
- **Month by month**: twelve calendar months of income, expenses and net.
  The current month is marked as partial.
- **IR3 pack**: covers both books at once (the book toggle has no effect
  here). Sections: *Rental — Cashel St*, *Tommy Tinkers*, *Other taxable
  income* and *Home office* (eligible costs × 12.57%). Two figures the bank
  feed can't see are entered here once a year: the **Ray White management
  fee** and the **ASB mortgage interest** from the loan statement. Leave
  either blank and the report says so loudly. Mortgage repayments stay out
  of deductible expenses until the interest figure is entered. **Export**
  downloads the pack as an `.xlsx`.

Read every warning on the IR3 pack before passing figures on. The 12.57% rate
is only verified for FY2027, and any other year is flagged. The open
questions (AIA treatment, the 50% entertainment limit) are printed as caveats
for your accountant rather than answered.

#### Savings goals (`/goals`)

Personal book only. A goal is one savings account, a target amount and,
optionally, a target date. Progress *is* the account's bank balance, so
nothing about it is stored separately and it can't drift from the bank.

- **New goal**: name, account, target and target date. The date must be in
  the future when you create the goal.
- Each goal shows how much is still to go and, with a date, what you need to
  put in each pay period. It also shows your average over recent periods and
  a projected finish date.
- The goal's own page lists the pay periods behind that average, so you can
  check it by eye.
- **Archive** a finished goal. Only archived goals can be **deleted**, and
  deleting needs a confirmation box ticked first.
- One active goal per account, because two goals on one account would both
  count the whole balance.

Goals are display only. They don't change anything on the Budget screen.

#### Sync status (`/sync`)

Is the database still filling itself? A sync that has quietly stopped looks
just like one with nothing new to import, so check here when numbers look
stale.

- **Accounts**: balance, book, and badges. *balanced* means zero drift.
  *drift $x* is a mismatch, which turns red if it persists. *needs mapping*
  means no book is assigned. *needs re-consent* means the Akahu connection
  has lapsed. *$x pending* is normal on card accounts.
- **Recent sync runs**: when each ran, success or failure, new rows, and
  "already held". Some "already held" rows are healthy, because each sync
  re-reads the last seven days to catch late-posted transactions.
- Alerts at the top flag a sync that's overdue or failing.

### How do I…

#### Fix a transaction in the wrong category?

Just this once: open it from Transactions and change the category, or tick
several rows and bulk-apply one. If it keeps happening, add a rule instead
(see [Fixing a category that's wrong](#fixing-a-category-thats-wrong)) so
future syncs get it right.

#### Clear everything uncategorised?

Use the link in the warning on Budget, or Transactions → **Needs a
category** → Apply. Work down the list with bulk categorise. Run
`npm run categories:review` to see the same queue grouped by pattern, which
shows where a new rule would cover many rows at once.

#### Record cash I spent?

Transactions → **Add cash entry**. Categorise the original ATM withdrawal as
*Cash Withdrawals*. The cash entry records where the money actually went.

#### See what the business spent between two dates?

Switch to **Business**, open Transactions, set From and To, then Apply.
Bookmark the resulting address if you'll want it again.

#### Hand my accountant the IR3 figures?

Reports → **IR3 pack** → pick the FY → enter the management fee and mortgage
interest → read the warnings → **Export**.

#### Check whether today's transactions are in?

Open **Sync status**. Look at the latest run and each account's "Last
synced". Banks post late, so a transaction from today may only arrive in a
day or two.

#### Run a sync right now?

On the homelab:

```bash
docker compose exec worker npx tsx src/scripts/sync-daily.ts
```

On a dev machine, `npm run sync:daily`. Both run the same code as the
scheduled 7am sync.

#### Deal with a new bank account?

It appears on Sync status as *needs mapping* after the next sync. Assign it a
book:

```bash
npm run accounts:map -- "Account name" PERSONAL
```

Its transactions can be categorised after that.

#### Deal with "needs re-consent"?

Akahu's access to that bank has lapsed. Reconnect the bank at
[my.akahu.nz](https://my.akahu.nz). The next sync then catches up.

### When something looks wrong

| You see | Likely cause | Do this |
| --- | --- | --- |
| Figures seem low | Uncategorised transactions, or an unmapped account | Follow the warnings at the top of Budget |
| A number hasn't changed since yesterday | The sync didn't run (host asleep, worker stopped) | Sync status. The worker catches up by itself on startup if the last good sync is over 36 hours old. |
| "Database unreachable" on Sync status | Postgres is down | `docker compose up -d db` |
| An account shows persistent drift | A missing or doubled transaction | Compare that account against the bank statement |
| A transfer counted as income | The pair isn't confirmed yet | Transfers screen, or the CLI for contested ones |
| "Your session has expired" on save | The 30-day session ran out mid-form | Reload, sign in, submit again |
| Cash entry fails to save | Cash accounts don't exist yet | `npm run accounts:seed-cash` (the app normally does this on startup) |
| A category you picked was refused | It belongs to the other book | Choose a category from the transaction's own book |

## Backups

A fourth container runs `pg_dump` nightly at 2am NZ and a restore test at
3:30am Sunday. `docker compose logs backup` is the whole history.

What's being protected is worth being precise about, because it sets the bar.
The bank transactions are re-fetchable — Akahu hands them back on a fresh
baseline pull. What is *not* recoverable is everything a human decided: which
category each transaction is in, which transfers were confirmed as pairs,
which book each account belongs to. That's hours of judgement stored nowhere
else.

How it avoids the usual ways backups fail:

- **A partial dump is never mistaken for a good one.** Dumps are written to
  `.partial` and renamed only after they verify. A rename within a filesystem
  is atomic, so a crash mid-dump leaves obvious junk rather than a truncated
  file that looks fine until you need it.
- **Every dump is read back.** `pg_restore --list` runs against it immediately;
  a dump that can't be listed is deleted and the run fails.
- **Restores are tested weekly, not assumed.** The newest dump is restored into
  a throwaway database, its rows counted, and the database dropped. An empty
  restore fails the check — a successful restore of nothing is the failure this
  is looking for.
- **A suddenly tiny dump is flagged.** Less than half the previous size warns
  loudly. That's what a dump of an empty database looks like.
- **Pruning can't empty the directory.** Retention is 30 days, but the newest 7
  are kept regardless, so a container starting after a long outage can't delete
  everything before writing its first new backup.
- **Backups live on their own volume.** `db-backups`, not inside `db-data` — a
  backup stored in the volume it protects dies with it.

Restoring *over* the live database is deliberately not scripted. It's a slow,
deliberate decision, so the command should be in front of you when you make it:

```bash
docker compose exec backup pg_restore --username=moneybook --dbname=moneybook --clean --if-exists --no-owner --exit-on-error /backups/moneybook-YYYYMMDDThhmmssZ.dump
```

Stop the app and worker first, or they'll write into a half-restored database.

**Still to do:** `db-backups` is a local Docker volume, which survives a bad
command but not a dead disk. Point it at a NAS bind mount to fix that.

## Security

- Read-only Akahu tokens stored as Docker secrets — never in the repo or database
- LAN-only binding, remote access via Tailscale, HTTPS even on the local network
- Nightly database backups on a separate volume, restore-tested weekly

## Status

Phases 1, 2 and 3 complete, running against twelve months of real bank data —
2,687 transactions across 11 accounts, from 16/07/2025. Phase 3 was the
go-live point, so the Excel tracker is now the frozen pre-baseline archive.

The database fills itself: accounts and transactions sync from Akahu, dedupe
on Akahu's transaction ID, reconcile against the reported balance, categorise
themselves against the rule set, and log every run.

**82% categorised automatically** — 818 transfer legs paired and 1,382 matched
by rule, leaving 487 in the review queue (about half of which are deliberate:
transfer suggestions awaiting confirmation, and one payee stream that needs a
human to split it). Rolling 12-month business turnover is $822.50 as at
09/09/2026 against the $60,000 GST threshold — a figure that moves every day,
which is why the app now shows it live at `/reports` rather than leaving it
in a document. All four tax questions the IR3 needs — rental income and
expenses, business income and expenses by type, home office eligible costs,
GST turnover — are answerable from the tax tags.

Phase 2 overturned one of the plan's assumptions. It expected the category
list to be built from Akahu's suggested categories; in reality only 32% of
transactions carry any Akahu enrichment and **none of the income does** —
Akahu's enrichment only fires on card spending. Descriptions had to carry the
work instead. [docs/phase-2-discovery.md](docs/phase-2-discovery.md) has the
evidence, [docs/phase-2-design.md](docs/phase-2-design.md) the decisions.

Reconciliation is clean: all 11 accounts sit at zero drift. Getting there meant
fixing a real bug — the check compared settled transactions against a bank
balance that already included unsettled card authorisations, so any account
with live card activity showed permanent drift. A warning that is always on is
a warning nobody reads, and it would have buried a genuinely missing
transaction in noise.

Phase 3 shipped in three parts. 3a is authentication and the transaction list;
3b is the budget, which redefined "dashboard" as the pay-period surface on the
grounds that a screen showing what you spent without saying what you *meant*
to spend is a report rather than a tool; 3c is `/reports`, which is that
report — FY income and expenses per book, a ranked category breakdown, the
month-by-month view, and the rolling GST turnover monitor.

That leaves the app carrying two date regimes on purpose. `/budget` runs 20th
to 19th because the question is "how much until payday?"; `/reports` runs
01/04–31/03 and a rolling twelve months because IRD says so. They will never
agree, so every reports figure prints its literal date range beside it. 3c
also fixed the GST turnover window, which compared a UTC-midnight date against
the current instant and so dropped today's business income for the first
twelve hours of every NZ day.

**Phase 4a landed 16/09/2026**: `/reports/ir3`, the IR3 pack. It reads both
books at once rather than the usual `?book=` toggle, because an IR3 return is
one document, not a per-book one — Cashel St rental and other personal
income sit in PERSONAL, Tommy Tinkers in BUSINESS, and the home office
deduction spans both by tax tag. It also adds the one form in the app that
isn't a category or a transaction: the Ray White management fee and the ASB
mortgage interest, entered once a year, because the bank feed structurally
cannot see either. Leaving one blank doesn't quietly borrow the bank-fed
total as if it were correct — the mortgage payments category is excluded
from the deductible total entirely until the interest is confirmed, which is
the safe direction to be wrong in on a document going to IRD. AIA's taxable
treatment, the entertainment 50% limit, and the mortgage interest figure
itself are still open questions for Garreth; the report states them as
caveats rather than picking an answer.

**Phase 4c landed 02/10/2026**: `/goals`, savings goals. A goal is
measured by its account's Akahu balance, and nothing about progress is
stored, so a goal is reconciled against the bank every day and can't drift
from it. At most one active goal per account, enforced by a partial unique
index (Prisma's `partialIndexes` preview), because two goals on one bucket
would each count the whole balance while every figure still matched the
bank. It's display only: nothing on `/budget` changes. Reached from a link on
`/budget` rather than a nav item. Archived goals can be deleted; active ones
can't. Review before merging caught two pace errors that made a goal look
better than it was (a period already paid counted as one still to pay, and a
dormant bucket's history measured from its first deposit), both now fixed
and unit-tested.

That completes Phase 4 as planned.

Built in the open as a learning and portfolio project.

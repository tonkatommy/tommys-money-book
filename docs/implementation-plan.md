# Tommy's Money Book — Implementation Plan

> **Copy in the repo.** The editable original lives in OneDrive
> (`Documents/Claude/Projects/💲Accounting - Tommy's Life/documents/Finance_App_Implementation_Plan.md`).
> This copy travels with the code so the architecture, data model, and phase
> definitions are readable from a clone alone. Edit the original, then re-copy.

**Project:** Tommy's Money Book — web app replacement for the Expense Tracker
**Author:** Claude, with Tommy Goodman
**Date:** 16/07/2026 (revised same day: Akahu-first approach)
**Status:** Draft for review

---

## 1. Summary

Replace the Excel tracker with a self-hosted web app running on your homelab,
built around the Akahu API from day one. No Excel migration and no CSV import:
on first connection the app pulls all available history from Akahu as the
baseline, and from then on a daily scheduled sync keeps it current. The category
list isn't ported from the old Chart of Accounts either — it gets built
bottom-up from Akahu's suggested categories once real data is flowing, then
refined into a lean set that still covers what the IR3 needs. The MVP is a
dashboard plus transaction management (view, categorise, annotate), LAN-only,
single user. Akahu personal apps are free, cover ANZ and BNZ, and refresh daily.

The Excel tracker is frozen as-is and kept as the historical archive — nothing
is deleted, it just stops being maintained once the app is live.

This doubles as a portfolio project: it exercises the exact stack you're job
hunting with (React/Next.js, Node, PostgreSQL, Docker) and gives you a real
production deployment story.

---

## 2. Bank feed research findings

### The landscape (as at July 2026)

NZ open banking is now regulated. The Customer and Product Data Act 2025
designated ANZ, BNZ, ASB, and Westpac as data holders from 01/12/2025 — they
must share customer data (balances, up to two years of transaction history,
statements) with accredited third parties when the customer consents, and
they're prohibited from charging for it. Kiwibank joins during 2026.

The catch for you: **direct access requires accreditation**, which is designed
for businesses, not individuals with a homelab. You won't be registering as an
accredited requestor to read your own accounts.

### The practical route: Akahu personal app

[Akahu](https://www.akahu.nz) is NZ's open finance platform and the standard way
hobbyists get API access to their own bank data. It sits on top of the official
open banking APIs (it's migrating all traffic to them where available). A
**personal app** gives you:

| Feature | Personal app |
| --- | --- |
| Price | Free |
| Users | 1 (your own Akahu account only) |
| Banks | ANZ and BNZ both supported (plus ASB, Westpac, Kiwibank, and others) |
| Account data + transactions | Yes |
| Scheduled refresh | Daily (fixed) |
| Manual refresh | Allowed, 1-hour rest period between refreshes |
| Webhooks | No — you poll |
| Payments | No (read-only, which is what we want) |

Setup: create a profile at my.akahu.nz, connect your ANZ and BNZ logins,
complete identity verification and 2FA, and you get a User Access Token and App
ID Token. Two headers on every request. There's an official Node SDK (`akahu` on
npm), which fits your stack directly.

**Practical implications for the app design:**

- "Live" means **daily**, not real-time. That's fine for bookkeeping — it's
  dramatically better than downloading CSVs from two banks.
- No webhooks means the app runs a scheduled sync job (e.g. a cron container or
  node-cron task) that pulls new transactions each morning.
- Akahu transactions come pre-enriched (merchant name, category, transaction
  type) via its Genie enrichment — this is what the new category list gets built
  from.
- **Baseline depth:** under the regulated system banks provide up to two years
  of transaction history, but how much Akahu actually returns on first
  connection varies by bank. Verify this in the first week of Phase 1 — it
  determines how far back the app's records start. Anything older lives in the
  frozen Excel archive.
- Both your personal ANZ accounts and the BNZ business account connect under one
  Akahu profile, and each Akahu account maps to one of your named accounts — the
  personal/business split stays clean because the split happens at the account
  level.

### Alternatives considered

- **Direct bank APIs (ANZ/BNZ developer portals):** accredited/registered third
  parties only. Not available to individuals.
- **CSV import / Excel migration:** deliberately dropped (decision 16/07/2026).
  Akahu is the sole ingestion path; the Excel tracker is a frozen archive, not a
  data source. If Akahu ever changes its personal-app terms, a CSV importer can
  be added later — the schema's `source` and `externalId` fields leave the door
  open.
- **Off-the-shelf self-hosted (Firefly III, Actual Budget):** Firefly III even
  has community Akahu importers. Worth knowing these exist, but they don't model
  your XFR pairs, personal/business books, or NZ FY reporting the way you need —
  and building it yourself is half the point.

---

## 3. Relationship to the Excel tracker

The tracker is **not migrated** — it's frozen as the historical archive the day
the app's baseline lands. The app's concepts still descend from it, but the data
arrives fresh from Akahu:

| Tracker concept | In the app |
| --- | --- |
| Personal TX / Business TX sheets | One `transactions` table with a `book` field, populated entirely from Akahu |
| Personal / Business Chart of Accounts | New lean category list, built from Akahu's suggested categories after real data flows (see §6, Phase 2) |
| Accounts Reference / _Lists | `accounts` table — each Akahu-connected account mapped to a book at setup |
| Dashboard / Financial Breakdown | Rendered live from queries — never stored, never stale |

Rules that carry over regardless of what the category list ends up looking like:
transfers between your own accounts are never income or expenses and must net to
zero as pairs; personal and business never mix; FY runs 01/04–31/03; reports
exclude transfers from totals.

One thing not to lose when rebuilding categories from scratch: the old COA
encodes **tax requirements**, not just preferences. Whatever the new list looks
like, it must still be able to answer: gross rental income and rental expenses
(IR3), Tommy Tinkers income and expenses by deductible type (IR3), home office
eligible costs (12.57%), and running 12-month business turnover (GST threshold).
Bottom-up discovery decides the shape; these four reporting needs decide the
minimum.

---

## 4. Architecture

```text
┌─ Homelab (Docker Compose) ─────────────────────────┐
│                                                     │
│  ┌────────────┐   ┌─────────────┐   ┌────────────┐  │
│  │  Next.js    │──▶│ PostgreSQL  │◀──│ Sync worker│──┼──▶ Akahu API (Phase 1)
│  │ (UI + API   │   │             │   │ (cron)     │  │
│  │  routes)    │   └─────────────┘   └────────────┘  │
│  └────────────┘          │                           │
│                     nightly pg_dump ──▶ backup vol   │
└─────────────────────────────────────────────────────┘
        ▲  LAN / Tailscale only — no port forwarding
```

**Stack choices, and why:**

- **Next.js (App Router) with API routes** — one codebase for UI and backend.
  You don't need a separate Express server; Next.js API routes are Node
  endpoints. Fewer moving parts for a solo project, and it's the framework
  you're being hired on.
- **PostgreSQL** — you know it, and financial data wants a relational schema
  with constraints (e.g. a CHECK that a business transaction can't carry a PEX
  category).
- **Prisma ORM** — schema-as-code, generated types, and migrations. As a junior
  dev, Prisma's migration workflow teaches you how schema changes are managed
  properly in real teams.
- **Docker Compose** — three services (app, db, sync worker) plus a backup job.
  Matches your homelab experience.
- **Charts:** none. Recharts was the original choice and was reconsidered in
  Phase 3c (24/08/2026) when the first charting need actually arrived. Declined:
  every screen in this app is a server component that works with JavaScript
  disabled, and Recharts is a client component, so it would have been the first
  client JS in the app in exchange for a bar chart on a screen whose whole value
  is the numbers. Breakdowns render as ranked bar tables built from the existing
  design-system primitives. Revisit only if a genuinely chart-shaped question
  appears, not for the next breakdown.
- **Auth:** a single shared password/session is enough for LAN-only single-user
  (see §7). Don't build a user system you don't need.

---

## 5. Data model

```prisma
model Account {
  id          String   @id @default(cuid())
  name        String   @unique      // "ANZ Everyday", "BNZ Tommy Tinkers", ...
  book        Book                  // PERSONAL | BUSINESS
  akahuId     String?  @unique      // linked in Phase 4
  transactions Transaction[]
}

model Category {
  id          String   @id @default(cuid())
  name        String                // "Groceries" — list built from real data in Phase 2
  book        Book                  // which set of books it belongs to
  kind        Kind                  // INCOME | EXPENSE | TRANSFER | OWNER
  taxTag      TaxTag?               // RENTAL_INCOME | RENTAL_EXPENSE | BIZ_INCOME | BIZ_EXPENSE |
                                    // HOME_OFFICE | TAXABLE_INCOME | null — drives IR3/GST reports
  rules       CategoryRule[]
  transactions Transaction[]
}

// Added in Phase 2, replacing `Category.akahuNames`. See §6.
model CategoryRule {
  id          String   @id @default(cuid())
  categoryId  String
  field       RuleField             // AKAHU_CATEGORY | MERCHANT | DESCRIPTION
  pattern     String                // lower-cased; normalised for DESCRIPTION
  accountId   String?               // optional scope to one account
  direction   RuleDirection         // IN | OUT | ANY — the sign of amountCents
  priority    Int                   // lower wins within a tier
  note        String?               // why this rule exists
}

model Transaction {
  id          String   @id @default(cuid())
  date        DateTime @db.Date
  accountId   String
  payee       String?
  description String
  categoryId  String?
  amountCents Int                   // integer cents — never floats for money
  notes       String?
  source      Source   @default(AKAHU)  // AKAHU | MANUAL (cash the bank never sees)
  categorySource CategorySource?    // RULE | MANUAL | TRANSFER — the matcher never
                                    // overwrites a category a human chose
  externalId  String?  @unique      // Akahu transaction id → dedupe on re-sync
  transferPairId String?            // links XFR-01 ↔ XFR-02 legs
  account     Account  @relation(...)
  category    Category? @relation(...)
}
```

Design notes worth understanding, not just copying:

- **Money as integer cents.** Floating point can't represent $0.10 exactly; sums
  drift. Store `-20000` for -$200.00, format at the edge.
- **`book` on both account and category** lets the database enforce the golden
  rule: a constraint (or app-level validation) rejects a personal category on a
  business account. In Excel this rule lived in your discipline; here it lives
  in the schema.
- **`transferPairId`** makes the two legs of a transfer a first-class linked
  pair. Akahu marks many inter-account transactions with a transfer type, and
  matching ±amounts on the same day catch the rest — the app suggests pairs, you
  confirm. Unpaired transfers surface as a warning, automating the netting
  check.
- **`externalId`** holds Akahu's stable transaction ID. Re-running a sync (or
  the baseline pull) can never double-import — the exact class of problem that
  has bitten the spreadsheet.
- **`taxTag` on categories** is the bridge between a freeform category list and
  the IR3. You can rename, merge, and reshape categories freely; as long as the
  tags are right, year-end reports don't care what the categories are called.
  Phase 2 added a sixth tag, `TAXABLE_INCOME`: the original five quietly assumed
  all personal taxable income was rental income, which left salary, the W&I
  benefit and $47,555 of AIA income-protection payments indistinguishable from
  genuinely non-taxable receipts (flatmate cost-sharing, gifts, KiwiSaver
  withdrawals).
- **`CategoryRule` replaced `Category.akahuNames`** (Phase 2, 01/08/2026). The
  original design assumed Akahu's suggested category names could drive
  auto-categorisation. Against real data they cover 32% of transactions and 0%
  of income — Akahu's enrichment only fires on card spending — and an
  exact-match name list cannot express the exceptions that decide tax treatment.
  IAG bills three policies from one merchant and only the landlord one is a
  rental deduction; PayPal is the Shopify subscription in the business book and
  anything at all in the personal one. Rules match on description, merchant, or
  Akahu category, ordered by computed specificity.
- **`categorySource` is what makes corrections stick.** A category assigned by a
  rule can be re-derived; one assigned by a human must not be. Without the
  distinction, every daily sync would re-run the matcher over hand-corrected
  rows and silently restore exactly the answer that was wrong — leaving books
  that still balanced.
- **Reconciliation subtracts pending transactions.** The bank's reported balance
  includes card authorisations that haven't settled; the transaction feed
  contains only settled rows. Comparing one against the other gave permanent
  non-zero drift on any account with live card activity (found 01/08/2026: ten
  pending authorisations on ANZ Money Card totalling exactly the -$233.02 of
  drift). Pending totals are fetched and subtracted; pending rows are never
  imported, because their ids are unstable and their amounts change when they
  settle.
- **FY is derived, not stored:** NZ FY = year of `date + 9 months`. A
  transaction on 15/03/2027 is FY2027; 15/04/2027 is FY2028. Implemented in
  Phase 3c as TypeScript bounds that every report filters on
  (`src/lib/reports/fy.ts`), not as the SQL expression this line originally
  called for: `period.ts` already solves the identical problem that way, the
  bounds are unit-testable without a database, and a raw SQL fragment would have
  been the only one in the codebase.

---

## 6. Build phases

### Phase 0 — Repo and scaffolding (a weekend)

Set up the repo (feature branches + PRs, never commit to main, per your own
rules), scaffold Next.js + Prisma + Postgres in Docker Compose, get "hello
database" running on the homelab. Deliverable: `docker compose up` serves a page
that reads from Postgres.

### Phase 1 — Akahu connection, baseline pull, daily sync (2–3 weekends)

The foundation everything else sits on:

- Create Akahu profile at my.akahu.nz, connect ANZ + BNZ logins, complete ID
  verification and 2FA, create the personal app. Store the two tokens as Docker
  secrets (never in the repo or the DB).
- **Baseline pull:** fetch every account and all available transaction history
  into Postgres, raw and uncategorised. Check how far back each bank's history
  actually goes (up to two years under the regulated system, but verify per
  bank) — this defines the app's day zero.
- Map each Akahu account to a book (personal/business) in the `accounts` table.
- **Daily sync worker:** scheduled job (node-cron container) pulls transactions
  since the last sync per account, deduping on Akahu's transaction ID. Log every
  run; alert (even just a dashboard banner) when a sync fails or an account's
  connection needs re-consent.
- Reconciliation check: Akahu-reported balance vs sum of stored transactions per
  account, flagged when they drift.

Deliverable: a database that fills itself every morning. No UI beyond a bare
sync-status page.

### Phase 2 — Category discovery and refinement (1–2 weekends)

Deliberately after the baseline, so decisions are driven by real data:

- Report over the baseline: Akahu's suggested categories and merchants, ranked
  by transaction count and dollar volume, split by book. This shows what your
  spending actually looks like rather than what a pre-drawn chart of accounts
  assumed.
- Sit down with that report (a session with Claude, ideally) and shape the final
  category list: merge Akahu's granular suggestions into the buckets you'll
  actually use, add the ones Akahu can't know (owner drawings/contributions),
  and apply `taxTag`s so IR3 and GST reporting needs are covered (§3).
- Store each category's `akahuNames` mapping so future synced transactions
  auto-categorise; unmapped ones land in a review queue.
- Transfer detection pass over the baseline: Akahu's transfer type + same-day
  ±amount matching across your accounts → suggested pairs, bulk-confirm UI.
- Bulk re-categorisation tools, because the first draft of the list will be
  wrong in places and that must be cheap to fix.

Deliverable: baseline fully categorised, auto-categorisation rules live for the
daily sync.

**Completed 01/08/2026.** The outcome differed from the plan in one important
way: the category list could not be built from Akahu's suggestions, because only
32% of transactions carry any Akahu enrichment and none of the income does.
Normalising bank descriptions (stripping card numbers and per-transaction
references) collapsed 1,786 uncategorised rows to 184 distinct keys, so ~140
rules cover the baseline instead. 63 categories; 82% categorised automatically —
818 transfer legs paired and 1,382 rule-matched, leaving 487 for review. Tier 1
transfer pairing turned out to be deterministic rather than heuristic: ANZ names
the counterparty account in both legs, giving 403 of 404 pairs with zero
unmatched. Tier 2 (standing orders, cross-book owner movements) stays manual — a
real standing order collides with a real flatmate payment on the same day for
the same amount 17 times across the baseline, and auto-netting the wrong one
would erase income while leaving the books balanced. Full detail in
`docs/phase-2-discovery.md` and `docs/phase-2-design.md`.

### Phase 3 — MVP: dashboard + transactions (3–4 weekends)

- Transaction list: filter by book, account, category, date range,
  uncategorised; search payee/description.
- Edit/categorise/annotate synced transactions; manual-entry form only for cash
  the bank never sees; transfer-pairing helper.
- Dashboard: month and FY-to-date income/expenses per book (transfers excluded),
  category breakdown, account balances from Akahu, GST-threshold running
  12-month turnover for Tommy Tinkers.
- Monthly breakdown view (the Financial Breakdown sheet, live).

**This is the go-live point.** The Excel tracker freezes here as the
pre-baseline archive.

**Split into 3a, 3b and 3c in delivery.** 3a shipped auth and the transaction
list (PRs #10 and #15); 3b shipped the budget (PRs #14 and #17) and redefined
"dashboard" as the pay-period budget surface rather than a reporting screen, on
the grounds that a dashboard which shows what you spent without saying what you
*meant* to spend is a report rather than a tool. That was the right call and it
left the four reporting items above unbuilt, which is what Phase 3c is: the GST
turnover monitor, FY-to-date per book, the category breakdown and the monthly
breakdown, in a `/reports` section. Specs:
`docs/superpowers/specs/2026-08-02-phase-3-transactions-design.md`,
`2026-08-15-phase-3b-budget-design.md`, `2026-08-24-phase-3c-reports-design.md`.

**Completed 09/09/2026, with 3c.** Phase 3 is done against this plan and the app
is at its go-live point; the Excel tracker freezes here as the pre-baseline
archive. 3c shipped `/reports` in two PRs: the FY derivation and the reads first
(`src/lib/reports/fy.ts` and `query.ts`, the `/reports` index, a seventh nav
item), then `/reports/categories`, `/reports/months` and the `RankedBars`
primitive.

Three things about 3c are worth carrying forward:

- **It fixed a live wrong number before surfacing it.**
  `rollingBusinessTurnoverCents` compared a `@db.Date` at UTC midnight against
  `new Date()`, so from NZ midnight to NZ noon today's business income fell
  outside the twelve-month GST window, and the far boundary slid with the clock
  — the window was neither twelve months nor the same twelve months at 9am as at
  9pm. It did not matter at $982.84 against a $60,000 threshold, and it would
  have mattered permanently the first time the figure was read in anger, because
  GST registration is triggered by turnover in the *past* twelve months and the
  history cannot be recomputed from a better clock.
- **The app now carries two date regimes**, pay period and financial year, and
  that is the phase's standing risk rather than a solved problem: August on
  `/budget` and August on `/reports` are not the same August. The mitigation is
  that every reports figure prints its literal DD/MM/YYYY range beside it and
  the shell header keeps calling its own dates "Pay period".
- **No chart library and no client JavaScript**, per the Charts line in §4. The
  breakdowns are ranked bar tables and a month table, server-rendered, and the
  JS-disabled rule needs no exception for this section.

Not done here, and deliberately: the IR3 pack, the home office calc and any xlsx
export, all of which are Phase 4. 3c surfaces figures for Tommy to read; Phase 4
produces a document for the accountant, which is a different problem with a
different audience.

### Phase 4 — Reports and year-end (ongoing)

- IR3 pack: FY summary of rental income and expenses, Tommy Tinkers
  income/expense summary by tax tag, home office calc (12.57% of eligible
  costs), exported to xlsx for Garreth. Note the first app-generated year-end
  may need the Excel archive alongside it if the baseline doesn't reach back to
  01/04/2026 — check after Phase 1.
- Budget vs actual, savings goals — the remaining recurring tasks from the
  project instructions.

**Split into 4a, 4b and 4c in delivery**, the same reason Phase 3 was split:
the IR3 pack, budget vs actual, and savings goals don't share a data layer,
and specifying all three at once means specifying two nobody is waiting on
yet. Spec: `docs/superpowers/specs/2026-09-16-phase-4a-ir3-design.md`.

**4a (IR3 pack) implemented 16/09/2026.** `/reports/ir3` reads both books at
once — the one reports screen that doesn't take a `?book=` filter, because an
IR3 return is a single document, not a per-book one. It surfaces the FY
rental summary (gross income, itemised expenses, the mortgage
interest/principal split), the Tommy Tinkers summary by tax tag
(`Entertainment` broken out, never auto-halved), the home office deduction at
12.57%, other taxable personal income, and an `.xlsx` download via `exceljs`.

The two figures the Akahu feed structurally cannot see — the Ray White
management fee and the ASB mortgage interest — are entered once a year
through a form (`TaxYearAdjustment`, one row per FY). Leaving either blank
does not quietly use the bank-fed total as the truth: the gross-up is
visibly short and the mortgage payments category is excluded from the
deductible total entirely rather than counted at full value, which is the
safe direction to be wrong in on a document going to IRD.

**Still open, and stated as caveats on the screen and in the export rather
than resolved in code**, because they're Garreth's call, not this app's:
whether AIA income-protection payments are taxable income or a non-taxable
lump sum, whether the NZ entertainment-deduction 50% limit applies, and
confirming the mortgage-interest figure against the actual ASB statement.
None of the arithmetic assumes an answer to any of the three. The figures
also haven't yet been reconciled against a real Ray White/ASB statement or
run past Garreth — do that before trusting this for an actual filed return.

4b (budget vs actual) and 4c (savings goals) are not yet designed.

Rough total: sync foundation in ~3 weekends, categorised data by ~5, MVP live
around ~8–9 weekends of part-time work. As a junior dev budget generously — the
learning is the point. The nice property of this ordering is that the riskiest
unknown (Akahu integration) is Phase 1, not Phase 4: if anything about the API
surprises you, you find out in week one, not after months of building.

---

## 7. Security and operations

- **No internet exposure.** Bind to LAN; use Tailscale for access away from home
  (you likely have this or WireGuard already). No port forwarding, no
  reverse-proxy hardening needed because there's nothing public to harden.
- **Secrets:** Akahu tokens grant read access to every connected account. Docker
  secrets or a `.env` outside the repo, `chmod 600`, never committed. Rotate via
  the Akahu dashboard if ever in doubt.
- **HTTPS even on LAN** — a self-signed cert or Tailscale's built-in certs; bank
  data shouldn't cross the wire in plaintext even at home.
- **Backups:** nightly `pg_dump` to a separate volume/NAS, and periodically test
  a restore. The corrupted-tracker episodes are the argument for this; a
  database you back up nightly and can restore beats a spreadsheet on OneDrive.
  **Implemented 01/08/2026** as a fourth compose service: 2am NZ nightly, dumps
  written to `.partial` and renamed only after `pg_restore --list` reads them
  back, a weekly automated restore into a scratch database, retention 30 days
  with a floor of 7 dumps. Backups live on their own volume, not inside the one
  they protect. Still to do: point that volume at the NAS, since a local Docker
  volume survives a bad command but not a dead disk.
- **Updates:** Watchtower or a manual monthly `docker compose pull`; Dependabot
  on the repo.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Baseline history shallower than expected | Verify per bank in week one of Phase 1; Excel archive covers everything older; first year-end may combine both |
| Akahu personal-app terms change | Accepted risk (no CSV fallback by decision). Schema keeps `source`/`externalId` generic so a CSV importer can be bolted on later if ever needed |
| Akahu suggested categories poor for NZ merchants | Phase 2 is a human review, not blind trust — Akahu suggests, you decide; bulk re-categorisation keeps corrections cheap |
| New category list misses a tax need | `taxTag` mapping reviewed against the four IR3/GST reporting needs (§3); run the first IR3 pack past Garreth |
| Sync silently stops | Sync log + failure banner from Phase 1; balance-drift reconciliation catches gaps |
| Homelab outage = no bookkeeping | Nightly backups; transactions accumulate at the bank and sync when back up |
| Scope creep kills the project | Phase 3 is the finish line for "usable"; everything after is gravy |
| Token leak | LAN-only, Docker secrets, read-only tokens, rotation |

---

## 9. Decisions already made

App is source of truth · Akahu is the sole data source from day one —
full-history baseline pull, then daily scheduled sync; no Excel migration, no
CSV import (16/07/2026) · Excel tracker frozen as pre-baseline archive ·
category list built bottom-up from Akahu suggestions after baseline, constrained
only by IR3/GST tax tags · MVP = dashboard + transactions · single user,
LAN/Tailscale only · stack = Next.js, PostgreSQL, Prisma, Docker Compose.

App name: **Tommy's Money Book** (confirmed 16/07/2026).

**Phase 2 decisions (01/08/2026):** flatmate contributions are cost-sharing, not
taxable income · AIA payments are taxable income protection · rental income from
Ray White is net of management fees, so the IR3 pack carries a warning and the
gross-up mechanism is deferred to Phase 4 · BNPL repayment is the expense, split
by lender · the Sovereign payments are the same Cashel St mortgage via a
different provider account · Energy Solution Providers is the employer from
20/07/2026 and becomes the main income source · `akahuNames` folded into
`CategoryRule`.

**Phase 4a decisions (16–17/09/2026):** the IR3 pack scoped as its own
sub-phase (4a), the same way Phase 3 split into 3a/3b/3c — budget vs actual
and savings goals become 4b/4c, since neither shares a data layer with the
IR3 pack and specifying all three at once meant specifying two nobody was
waiting on yet · the two figures the bank feed structurally cannot see (the
Ray White management fee, the ASB mortgage interest) are captured through a
form and a `TaxYearAdjustment` row per FY rather than a CLI script — a
number typed once a year off a paper statement isn't the bulk/dry-run
operation the CLI convention exists for · xlsx export via `exceljs` over
`xlsx`/SheetJS: better formatting for a document an accountant reads, and
worth noting `exceljs` also turned out to be the safer default on the npm
registry, not just the nicer one — SheetJS's own security-patched releases
have lagged behind what's published to npm · export is a download button
only; Tommy forwards it to Garreth himself, so "where reports land" needed
no separate decision · an implausible manual figure (mortgage interest
entered above what was actually paid that year) is capped at the plausible
maximum and warned about, not silently accepted or hard-rejected — the same
"never silently wrong" principle the sync and matcher already apply, now
extended to a number a human typed in.

**Open questions for you:** whether Vehicle_Logbook.xlsx eventually joins the
app; the AIA treatment, the entertainment 50% limit, and the Cashel St
mortgage interest figure all need confirming with Garreth before the first
filed IR3 — reconciliation against the real Ray White/ASB statements is
underway as of 17/09/2026, screen figures already checked out against what
was entered.

**Answered:** how far back each bank's Akahu history reaches — 16/07/2025,
about 12 months, not the hoped-for 24 (Phase 1). FY2027 is therefore fully
covered and the first app-generated IR3 is viable; FY2026 still needs the Excel
archive.

---

## Sources

- [Akahu — Personal Apps documentation](https://developers.akahu.nz/docs/personal-apps)
- [Akahu — Pricing](https://www.akahu.nz/pricing)
- [Akahu — Transitioning to Official Open Banking](https://developers.akahu.nz/docs/official-open-banking)
- [MBIE — Open banking regulations](https://www.mbie.govt.nz/business-and-employment/business/consumer-data-right/consumer-data-right-policy-design/open-banking)
- [MBIE — Consumer Data Right Standard, Open Banking](https://www.mbie.govt.nz/business-and-employment/business/consumer-data-right/consumer-data-right-policy-design/consumer-data-right-standard-open-banking)
- [ANZ — Open banking for developers](https://www.anz.co.nz/about-us/open-banking/open-banking-developers/)
- [Firefly III — Data Importer](https://docs.firefly-iii.org/explanation/data-importer/introduction/)

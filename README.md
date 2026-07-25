# Tommy's Money Book

A self-hosted personal finance app for New Zealand, built to replace a long-suffering Excel expense tracker. It pulls bank transactions automatically via the [Akahu](https://www.akahu.nz) open banking API, keeps personal and sole-trader business books strictly separate, and produces the numbers needed for NZ tax time (IR3 rental and business income, GST threshold monitoring).

Runs on a homelab. Single user. LAN/Tailscale only — nothing exposed to the internet.

## Why

Spreadsheets work until they don't. Manual CSV downloads from two banks, hand-categorised transactions, formulas that silently break, and a file that lives one sync conflict away from corruption. This app replaces all of that with:

- **Automatic daily bank feeds** — Akahu connects ANZ and BNZ under one profile and syncs transactions every morning. No CSVs, ever.
- **Two sets of books, one database** — every account and category belongs to either the personal or business book, enforced at the schema level rather than by discipline.
- **Transfers that net to zero** — movements between own accounts are first-class linked pairs, never counted as income or expenses.
- **Tax-aware categories** — categories carry tax tags (rental income/expense, business income/expense, home office) so year-end reports don't depend on what the categories are named.

It's also a deliberate portfolio project: a real production deployment of the stack I work in.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) — UI and API routes in one codebase |
| Database | PostgreSQL |
| ORM | Prisma — schema-as-code, typed client, migrations |
| Bank feeds | Akahu personal app (read-only, free tier, daily refresh) |
| Sync | Scheduled worker (node-cron) polling Akahu, deduping on transaction ID |
| Charts | Recharts |
| Deployment | Docker Compose on a homelab, nightly `pg_dump` backups |

## Architecture

```
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

- **Money is integer cents.** Floats can't represent $0.10 exactly; sums drift. `-$200.00` is stored as `-20000` and formatted at the edge.
- **Akahu is the sole ingestion path.** On first connection the app pulls all available history as its baseline; the old spreadsheet is frozen as an archive, not migrated.
- **`externalId` dedupe** means a re-run sync can never double-import a transaction. It's enforced by a unique constraint, so the database refuses duplicates regardless of what the application believes.
- **Reconciliation needs an opening balance.** Akahu only reaches back about two years, so "sum of stored transactions equals the bank balance" can never hold on its own. The balance that predates our earliest transaction is derived once at baseline; drift is measured against that from then on.
- **The incremental sync window looks backwards.** Each run re-reads the last seven days rather than starting where the previous run finished — banks post transactions late, and anchoring on run time would skip them permanently. Dedupe makes the overlap free.
- **NZ financial year (01/04–31/03) is derived from the transaction date**, not stored — one SQL expression used by every report.

## Roadmap

Full architecture, data model, and phase detail: [docs/implementation-plan.md](docs/implementation-plan.md).

- [x] **Phase 0 — Scaffolding:** Next.js + Prisma + Postgres in Docker Compose, "hello database" on the homelab
- [x] **Phase 1 — Bank feeds:** Akahu connection, full-history baseline pull, daily sync worker, balance reconciliation
- [ ] **Phase 2 — Categories:** build the category list bottom-up from real Akahu data, auto-categorisation rules, transfer pair detection
- [ ] **Phase 3 — MVP:** transaction list with filtering/search/edit, dashboard (income/expenses per book, category breakdown, balances, GST threshold) — go-live point
- [ ] **Phase 4 — Reports:** IR3 year-end pack, home office calculation, budget vs actual

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

`npm run dev` serves the sync status page at http://localhost:3000.

### Commands

| Command | What it does |
|---|---|
| `npm run akahu:probe` | Read-only: which accounts Akahu sees, and how far back each bank's history reaches. Writes nothing. |
| `npm run sync:baseline` | One-off full-history pull. Safe to re-run — dedupe means a second run imports nothing. |
| `npm run sync:daily` | One incremental sync. Same code path the worker runs. |
| `npm run accounts:map` | List accounts, or assign one to PERSONAL / BUSINESS. |
| `npm test` | Unit tests for the money, normalisation, window, and reconciliation logic. |

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

## Security

- Read-only Akahu tokens stored as Docker secrets — never in the repo or database
- LAN-only binding, remote access via Tailscale, HTTPS even on the local network
- Nightly database backups to a separate volume, restore-tested

## Status

Phase 1 complete: the database fills itself. Accounts and transactions sync
from Akahu, dedupe on Akahu's transaction ID, reconcile against the reported
balance, and log every run. Everything runs against fixtures until real tokens
are added.

Next up is Phase 2 — building the category list bottom-up from the real Akahu
data, now that there's data to build it from.

Built in the open as a learning and portfolio project.

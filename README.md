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
- **`externalId` dedupe** means a re-run sync can never double-import a transaction.
- **NZ financial year (01/04–31/03) is derived from the transaction date**, not stored — one SQL expression used by every report.

## Roadmap

- [ ] **Phase 0 — Scaffolding:** Next.js + Prisma + Postgres in Docker Compose, "hello database" on the homelab
- [ ] **Phase 1 — Bank feeds:** Akahu connection, full-history baseline pull, daily sync worker, balance reconciliation
- [ ] **Phase 2 — Categories:** build the category list bottom-up from real Akahu data, auto-categorisation rules, transfer pair detection
- [ ] **Phase 3 — MVP:** transaction list with filtering/search/edit, dashboard (income/expenses per book, category breakdown, balances, GST threshold) — go-live point
- [ ] **Phase 4 — Reports:** IR3 year-end pack, home office calculation, budget vs actual

## Getting started

> Not yet runnable — Phase 0 in progress. This section will grow as the scaffolding lands.

```bash
git clone https://github.com/tonkatommy/tommys-money-book.git
cd tommys-money-book
docker compose up
```

## Security

- Read-only Akahu tokens stored as Docker secrets — never in the repo or database
- LAN-only binding, remote access via Tailscale, HTTPS even on the local network
- Nightly database backups to a separate volume, restore-tested

## Status

Early days — repo scaffolding stage. Built in the open as a learning and portfolio project.

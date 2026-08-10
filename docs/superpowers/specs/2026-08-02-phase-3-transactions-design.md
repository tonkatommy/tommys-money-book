# Phase 3a — Transaction management: design

**Date:** 02/08/2026
**Input:** [implementation-plan.md](../../implementation-plan.md) §6 Phase 3;
current schema and code as of Phase 2 completion (01/08/2026).
**Status:** agreed with Tommy, ready to implement.

---

## 1. Scope

The implementation plan's Phase 3 bundles four things: a transaction list,
editing/manual-entry/transfer-pairing, a dashboard, and a monthly breakdown
view. The first two are transaction *management* — read and correct the data.
The last two are *reporting* — read-only views over data that's already
correct. The dashboard depends on categorisation being genuinely fixable from
the UI, so it belongs after this work, not alongside it.

**This spec covers transaction management only:**

- A filterable, searchable transaction list.
- Editing category and notes on synced transactions; full editing on manual
  ones.
- A manual-entry form for cash the bank never sees.
- A confirm UI for suggested transfer pairs.
- Session-based auth, since this is the first UI that can *write* to real
  financial data (the existing status page only reads).

**Explicitly not in scope (Phase 3b, a separate spec):** the dashboard,
month/FY-to-date summaries, category breakdown charts, account balance
tiles, GST-threshold turnover display, and the monthly breakdown view.

**Also not in scope:** a UI for Tier 3 (contested) transfer pairs — resolving
those needs manual cross-referencing the CLI (`transfers:confirm --out --in`)
already supports, and building suggestion UI for genuinely ambiguous pairs
isn't worth it yet. Creating new categories or rules from the UI — that's
`src/lib/categories/definitions.ts` plus `categories:seed`, unchanged.

---

## 2. Why auth now

Every page in the app so far (`/`, the sync status page) only reads data.
This phase adds pages that write real financial data — categorisation,
manual cash entries, transfer confirmations. The implementation plan (§7)
always intended a single shared password behind LAN/Tailscale; this is where
that gap has to close, before anything writable ships. It also retroactively
protects the existing status page, which currently has none.

**Design:** one shared password (`APP_PASSWORD` env var, provided the same way as the Akahu tokens — via environment variables or Docker secret files). `/login` is the only route that doesn't require a session.
Its Server Action compares the submitted password against `APP_PASSWORD`
with `crypto.timingSafeEqual` (not `===`, which short-circuits on the first
mismatched byte and leaks timing information about how much of the password
was guessed correctly). On success it sets an HttpOnly, `SameSite=Lax`
cookie whose value is `${issuedAt}.${hmac}`, where `hmac` is
`HMAC-SHA256(issuedAt, SESSION_SECRET)` (a second new env var). No session
table — verifying is recomputing the HMAC and checking `issuedAt` is within
30 days, so this stays as stateless as the rest of the app.

`middleware.ts` runs on every request except `/login` and Next's static asset paths; because middleware runs in the Edge runtime, cookie verification must use Web Crypto (`crypto.subtle`) rather than Node `crypto`.
If auth fails it redirects to `/login?next=<path>`, where `next` is URL-encoded and validated as a same-origin relative path (starts with `/`) to avoid open redirects. A logout action clears the cookie.

No lockout or rate-limiting on login attempts: single user, LAN-only, and a
determined attacker on the LAN has bigger options available than brute-forcing
a session cookie.

---

## 3. Data layer

Two new modules under `src/lib/transactions/`, following the existing
`src/lib/categories/` and `src/lib/transfers/` split of pure logic from the
scripts/pages that call it:

### 3a. `query.ts`

A pure function, `parseTransactionFilters(searchParams)`, turning URL search
params into a typed filter object — `book`, `accountId`, `categoryId`,
`uncategorised` (boolean), `from`/`to` (dates), `q` (free text), `page`. When
`from`/`to` are absent it defaults to the current calendar month (NZ time),
so the list is never "everything" by accident. A second function,
`queryTransactions(filters)`, turns that into a Prisma `findMany` (search
matches `payee` or `description`, case-insensitive `contains`) plus a
`count`, paginated 50 rows at a time.

### 3b. `mutate.ts`

- `setCategory(transactionId, categoryId)` / `setNotes(transactionId, notes)`
  — single-row updates. Sets `categorySource = MANUAL` on category changes
  (per the Phase 2 rule: a human decision is never overwritten by the
  matcher) and `categorisedAt = now()`.
- `bulkSetCategory(transactionIds[], categoryId)` — same, over many rows in
  one transaction.
- `createManualTransaction({ book, date, description, payee, categoryId,
  amountCents, notes })` — inserts with `source = MANUAL`, `accountId`
  resolved from `book` to the corresponding seeded Cash account (§5).
- `updateManualTransaction(transactionId, { date, description, payee,
  amountCents, notes })` — full-field edit, only ever called for rows where
  `source = MANUAL`; rejected server-side for `AKAHU` rows even if the UI
  never offers the form that would call it.

Every one of these re-validates that the category's `book` matches the
transaction's account's `book` before writing — the same book-safety rule
`src/lib/categories/match.ts` already enforces for the automatic matcher,
checked again here because this is a second, independent path to the same
data. A violation is rejected with an error, never silently coerced.

---

## 4. Pages

All server components except the two small client islands noted below.
Mutations are Next.js Server Actions invoked directly from `<form>`
elements — no API routes, no client-side fetching, matching the pattern
`src/app/page.tsx` already established for reads.

### 4a. `/transactions`

- **Filter bar:** a `GET` form (book, account, category, uncategorised
  checkbox, date range, search text) that submits to the same URL — filters
  live entirely in the query string, so the page is bookmarkable and the
  back button works.
- **Table:** one row per transaction (date, account, payee/description,
  category, amount, a book/manual badge). The whole table is wrapped in one
  `POST` form: each row has a checkbox (`name="ids"`, `value=<id>`), and a
  footer bar has a category `<select>` plus an "Apply to N selected" button
  that calls `bulkSetCategory`. Clicking anywhere on a row other than the
  checkbox links to `/transactions/[id]`.
- **Pagination:** simple page-number links (`?page=n`), preserving the rest
  of the query string.
- One client island: a tiny component tracking how many checkboxes are
  currently checked, purely so the footer button can say "Apply to 4
  selected" and disable itself at zero. The bulk action itself still works
  via plain form submission without it (progressive enhancement) — the
  island only improves the label and the disabled state.

### 4b. `/transactions/[id]`

Single-transaction detail. Bank-sourced fields (date, amount, payee,
description, account) are always read-only text — they're the bank's
record. Two independent small forms below them: a category `<select>`
(options scoped to the account's book) with a "Save" button calling
`setCategory`, and a notes `<textarea>` with its own "Save" button calling
`setNotes`. For a `MANUAL`-source transaction, the bank-sourced fields
become a third form (date, description, payee, amount) since there's no
bank record to protect — editing calls a `updateManualTransaction`
addition to `mutate.ts`.

### 4c. `/transactions/new`

Manual-entry form: date, book (radio, PERSONAL/BUSINESS — determines the
Cash account), description, payee (optional), category (`<select>`, options
filtered to the chosen book — re-filtered server-side on submit regardless
of what the client sent), amount (a plain dollar-and-cents text input) and
a Money In / Money Out radio, notes. On submit, amount and direction combine
into signed `amountCents`. Redirects to `/transactions` on success; on
validation failure (unparseable amount, no category) re-renders the form
with the values the user typed and an inline error, rather than losing the
input.

### 4d. `/transfers`

Lists Tier 2 suggested pairs, grouped the same way
`src/lib/transfers/detect.ts`'s `--confidence` output already groups them
(reusing that function directly rather than re-deriving the grouping) — one
row per group, with counts and total, and a "Confirm all in this group"
button. Tier 1 pairs never appear here; they're already auto-confirmed by
the sync path. Tier 3 doesn't appear either (§1) — a footer note points at
the CLI for anything not listed.

---

## 5. Manual (cash) accounts

`src/lib/transactions/mutate.ts` needs a `Cash — Personal` and
`Cash — Business` `Account` row to attach manual transactions to (every
`Transaction.accountId` is required, and pretending manual entries belong to
a bank account would be its own book-safety leak). These are created by a
small idempotent seed function (upsert by name, same idempotency style as
`categories:seed`), called once from a new `npm run accounts:seed-cash`
script and also from the app's startup path so a fresh clone doesn't need
the extra step before `/transactions/new` works. Both accounts have
`akahuId = null` and are excluded from Akahu-facing code paths (they're
never touched by sync or reconciliation, which already only look at accounts
with an `akahuId`).

---

## 6. Error handling

Server Actions return `{ ok: false, error: string }` instead of throwing,
matching the union-type pattern `src/app/page.tsx`'s `load()` already uses.
Errors render inline next to the form that produced them. A raw database
error is logged server-side and replaced with a generic message in
production (same `NODE_ENV` split as the existing status page) — the same
reasoning applies here as there: a Postgres error can name the host and
user.

Book-safety rejections (§3b) are a case of this: the UI should never let one
happen (category dropdowns are always pre-filtered to the right book), but
the server checks anyway and returns an error rather than trusting the
client.

---

## 7. Testing

Unit tests (vitest, no database — matching every existing test in the repo)
for:

- `parseTransactionFilters` — defaulting to current month, parsing each
  filter, malformed input (bad dates, non-numeric page) falling back safely
  rather than throwing.
- Manual-entry amount parsing — dollar strings to cents, Money In/Out sign,
  rejecting unparseable input.
- Book-safety checks in `setCategory`/`bulkSetCategory`/
  `createManualTransaction` — a personal category on a business account (or
  vice versa) is rejected.
- Session cookie sign/verify — valid, tampered (flipped byte), expired.

Page behaviour and Server Actions end-to-end need a live database and are
verified manually against the dev server, the same way Phases 0–2 were —
this repo doesn't run integration tests against Postgres in `npm test`
(`categories:seed --verify` is the equivalent manual-verification pattern
for categories; there's no new automated check needed here beyond the unit
tests above, since there's no bulk data-integrity invariant like rule
coverage to verify).

---

## 8. Not in scope

- The dashboard and monthly breakdown view — Phase 3b, a separate spec.
- A UI for Tier 3 transfer pairs (§1) — CLI only.
- Creating or editing categories/rules from the UI — `definitions.ts` +
  `categories:seed`, unchanged.
- Bulk recategorisation *by pattern* (the CLI's `categories:recat --match`)
  — the UI's bulk action is "select these specific rows", not "everything
  matching this text", which stays a CLI job.
- Rate-limiting or lockout on `/login`.

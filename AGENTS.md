<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all
differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Tommy's Money Book

A self-hosted NZ personal finance app over the Akahu bank feed. Two sets of
books, PERSONAL and BUSINESS (Tommy Tinkers, sole trader), kept strictly
separate. It produces the real figures behind a real IR3 return. Single user,
LAN/Tailscale only, Docker Compose on a homelab.

**The characteristic failure of this app is not a crash. It is a number that is
quietly wrong while every total still balances and nothing complains.** Weight
every judgement toward that.

## Read these before writing code

- `.github/skills/code-review/SKILL.md` is the authority on the domain
  invariants and on which odd-looking decisions are deliberate. Read it first.
  Do not restate its rules elsewhere; a second copy will drift from it.
- `docs/implementation-plan.md` for architecture, data model and phases.
- `docs/superpowers/specs/` for the design spec of each phase.
- The comments in the file you are about to change. This codebase carries its
  reasoning inline, and several things that look like bugs are documented
  decisions with the trade-off written out.

## Working agreement

- Never commit to main. Branch as `feat/`, `fix/`, `chore/` or `docs/`, then
  open a PR.
- Prefer editing an existing file over creating a new one.
- A phase gets an agreed design spec in `docs/superpowers/specs/` before it is
  implemented, following the shape of the existing specs: scope, what is
  explicitly out of scope, schema, data layer, screens, testing.
- When a phase lands, update the roadmap and status in `README.md` and the
  phase entry in `docs/implementation-plan.md` in the same PR.
- Reproduce, isolate, diagnose, fix. Do not guess, and do not fix by rewriting
  something you have not understood.

## Stack, as pinned

Next.js 16.2.10 (App Router), React 19.2.4, Prisma 7.8 with `@prisma/adapter-pg`,
PostgreSQL, Tailwind 4, Vitest 4, `tsx` for scripts, node-cron worker. Nothing
charts yet: Recharts is named in the plan but is not installed.

Per the Next.js block above, read `node_modules/next/dist/docs/` before writing
Next code. Note that the middleware convention in this version is
`src/proxy.ts`, not `middleware.ts`. That is correct, not a mistake.

## Invariants, in one line each

The full version, with the reasoning and the failure each one prevents, is in
the code-review skill.

1. A category may only attach to a transaction whose account is in the same
   book, re-validated on every write path. `book: null` means unmapped and
   cannot be categorised.
2. Money is integer cents, never floats, converted only through
   `src/lib/money.ts`. Expenses are stored negative and displayed positive,
   flipped once at the query boundary.
3. `categorySource = MANUAL` is what stops the daily sync overwriting a human
   correction. Set it on every hand categorisation; never overwrite it in bulk.
4. Transfers must be provable and net to zero. Tier 1 is deterministic and
   automatic, Tier 2 needs a human, contested suggestions are never
   auto-confirmed, Tier 3 is not attempted. Cross-book pairs are OWNER, not
   TRANSFER.
5. `Transaction.date` is `@db.Date` at UTC midnight; "today" resolves in
   `Pacific/Auckland` first, via `nzToday`. No bare `new Date()` for a period
   boundary.
6. Server Actions are reachable as direct POSTs. Every action re-checks
   `hasSession()`, and any list of ids carrying authority is re-derived
   server-side rather than trusted from the form.
7. A period with no budget rows is not a zero budget. Each category resolves to
   its most recent row with `periodStart <= period.start`.
8. Guard the divide-by-zero cases: zero budget, day 1 of a period,
   `daysLeft === 0`. Real data hits all three.

## House style

- Comments explain why, not what. Every file opens with a header comment saying
  what it is for.
- Server components throughout, mutations as Server Actions on plain `<form>`s.
  Screens must work with JavaScript disabled.
- Errors are returned, not thrown. The form re-renders with the message, and
  the submitted values come back from the action so a rejected submit does not
  blank good fields.
- Book selection lives in the query string (`?book=BUSINESS`), so the toggle is
  two links and needs no client state.
- Dark theme only, `en-NZ`, NZD, no i18n.
- Design tokens keep their original prototype names (`--surface-card`,
  `--text-primary`), with Tailwind `@theme` aliases layered on, so CSS pulled
  from the design project applies verbatim.
- Inline styles in components are deliberate, for portability against that
  design project.
- Categories and rules are code (`src/lib/categories/definitions.ts` plus
  `categories:seed`), not editable from the UI. A recurring fix gets a rule; a
  one-off gets `categories:recat`.
- CLI scripts are dry-run by default and require `--confirm` to write.

## Testing

Vitest, no database. Pure logic is unit-tested; anything touching Prisma is
verified by hand against the dev server at both phone and desktop widths. This
is deliberate and stated in the Phase 3a spec §7. Do not propose integration
tests against Postgres, a test database, or mocked Prisma clients. Do add a
unit test whenever a change introduces pure logic with a money or date
consequence.

Before opening a PR: `npm test`, `npm run typecheck`, `npm run lint`.

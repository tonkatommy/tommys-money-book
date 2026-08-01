# Phase 2 — Categories, rules and transfer pairs: design

**Date:** 27/07/2026
**Input:** [phase-2-discovery.md](phase-2-discovery.md) — run over the live
database, 2,642 real transactions.
**Status:** agreed with Tommy, ready to implement.

---

## 1. What the discovery report changed

The implementation plan (§6, Phase 2) assumed the category list would be built
from Akahu's suggested categories, stored as `Category.akahuNames`, and that
future transactions would auto-categorise from those names.

The data says that can't work:

- Only **32%** of transactions carry any Akahu enrichment, and merchant and
  category coverage are identical — enrichment is all-or-nothing per row.
- **100% of income is un-enriched.** Akahu's Genie only fires on card spending,
  so it cannot contribute a single income category.
- Akahu names can't express the exceptions that matter. `IAG` is three separate
  policies (motor, home, **landlord**) distinguishable only by a description
  suffix, and one of them is a rental deduction. `PayPal` is the Shopify
  subscription in the business book and anything at all in the personal one.

So `akahuNames` is **replaced** by a `CategoryRule` table. Akahu category names
become one rule type among three, rather than the whole mechanism. This is a
deliberate departure from plan §5 and §6, made because Phase 2 exists precisely
to test that assumption against real data.

The countervailing finding is that the problem is small. Normalising
descriptions collapses the 1,786 un-enriched rows to **184 distinct keys**;
~50 description rules plus the 118 merchant names reaches ~97% of the baseline.

---

## 2. Decisions taken with Tommy (27/07/2026)

| # | Question | Decision |
|---|---|---|
| 1 | `Thomas Brett` — 166 in ($20,972), 62 out ($3,808) | **Mixed.** Create `Reimbursements & Shared Costs`, `Loan Repayments Received`, `Loans & Advances Made`. No rule matches these — they go to the review queue and Tommy splits them with the bulk tools. |
| 2 | Flatmate income ($13,459) | **Cost-sharing, not taxable.** `Flatmate Contributions`, no taxTag, excluded from the IR3. |
| 3 | Rental income is net of Ray White's fee | **Warn now, build later.** Phase 2 seeds a `Rental — Management Fees` category and the IR3 pack carries a warning; the manual gross-up mechanism is Phase 4. |
| 4 | Afterpay / Finance Now ($8,582) | **Repayment is the expense, split by lender.** Two categories: `BNPL — Afterpay`, `BNPL — Finance Now`. |
| 5 | `Sovereign Account Go Home Loan Cashel St` ($11,810) | **Same Cashel St mortgage, different provider account.** Merges into `Rental — Mortgage Payments` with the ASB payments. |
| 6 | AIA claim ($47,555 over 20 payments) | **Taxable — income protection.** Needs a tag the enum doesn't have (see §3). |
| 7 | Stray receipts (Longden, Neilson, Metal Rec) | **Personal gifts/receipts**, non-taxable. |
| 8 | `Energy Solution Prov` ($2,059.99) | **Tommy's employer — started 20/07/2026.** Main income source going forward; one payment in the baseline, but `Salary & Wages` is the dominant FY2027 category. |
| 9 | `akahuNames` vs `CategoryRule` | **Fold into `CategoryRule`.** One matcher, one place to look. |
| 10 | The 2,642-row backlog | **Rules first, then review the remainder.** |

Still open, deliberately: the `ANZ Freelancing` account (23 rows, all internal
transfers and overdraft fees, no freelancing income ever landed) stays mapped
PERSONAL. Nothing depends on it.

---

## 3. Schema changes

One migration, `phase_2_categories`.

### 3a. `TaxTag` gains `TAXABLE_INCOME`

```prisma
enum TaxTag {
  RENTAL_INCOME
  RENTAL_EXPENSE
  BIZ_INCOME
  BIZ_EXPENSE
  HOME_OFFICE
  TAXABLE_INCOME   // new
}
```

The existing five tags cover the plan's four reporting needs, but they assume
all personal taxable income is rental. It isn't: salary from ESP, the W&I
benefit, and the AIA income-protection payments are all personal taxable income
that is neither rental nor business. Without a tag they'd be indistinguishable
from the non-taxable receipts (flatmate contributions, gifts, KiwiSaver
withdrawals, insurance refunds) — and $47,555 of AIA payments would be the
largest thing the IR3 pack silently omitted.

`TAXABLE_INCOME` means "personal income that belongs on the IR3 and isn't
rental or business". Whether IR pre-fills it from PAYE data is a convenience,
not a change of character, so salary and benefit carry it too.

### 3b. `Category.akahuNames` is dropped, `CategoryRule` added

```prisma
enum RuleField {
  AKAHU_CATEGORY   // exact match on Transaction.akahuCategoryName
  MERCHANT         // exact match on Transaction.merchantName
  DESCRIPTION      // substring match on the normalised description
}

enum RuleDirection {
  IN               // amountCents > 0
  OUT              // amountCents < 0
  ANY
}

model CategoryRule {
  id         String        @id @default(cuid())
  categoryId String
  field      RuleField
  pattern    String        // lower-cased; normalised for DESCRIPTION
  accountId  String?       // optional scope: "only on the BNZ business account"
  direction  RuleDirection @default(ANY)

  // Lower numbers win. Explicit rather than derived so a one-off exception
  // can be forced above a general rule without restructuring anything.
  priority   Int           @default(100)

  note       String?       // why this rule exists — future-you will ask

  category   Category  @relation(...)
  account    Account?  @relation(...)

  @@index([field, pattern])
}
```

### 3c. `Transaction` records how it was categorised

```prisma
enum CategorySource {
  RULE       // the matcher assigned it
  MANUAL     // a human assigned it — the matcher must never overwrite this
  TRANSFER   // assigned as a side effect of confirming a transfer pair
}

model Transaction {
  // ...
  categorySource CategorySource?
  categorisedAt  DateTime?
}
```

This is the single most important field in the migration. Without it, every
daily sync re-running the matcher would silently undo hand corrections — and
the corrections are exactly the cases the rules got wrong, so the damage would
be invisible and permanent. `MANUAL` rows are skipped by the matcher forever
unless `--force` is passed.

---

## 4. Description normalisation

The same function feeds discovery, rule matching, and the review queue, so a
key you see in the report is the key a rule matches on.

```
normaliseDescription(raw):
  lower-case
  strip " Card number: 4835 **** **** 3908"     -> ""
  collapse runs of 3+ digits                    -> "#"
  collapse whitespace
  trim
```

`MITRE 10 HELENSVILLE 6312 HELENSVILLE 434667131230` becomes
`mitre # helensville # helensville #`. Card numbers and per-transaction
reference numbers are noise; everything that identifies the payee survives.

This is pure and testable, and it is the reason 1,786 rows become 184 keys.

---

## 5. Match precedence

First match wins, and the order is **computed from the rule**, not declared.
Specificity is `fieldRank × 10 + (scoped to an account ? 0 : 2) + (scoped to a
direction ? 0 : 1)`, lower being more specific, with `priority` and then rule
id breaking ties.

| Field | Rank | What it knows |
|---|---:|---|
| `DESCRIPTION` | 0 | The raw bank text. Which IAG policy, which PayPal charge, which Blue Fern bill. |
| `MERCHANT` | 1 | Who was paid. Right about identity, silent about purpose. |
| `AKAHU_CATEGORY` | 2 | What kind of thing it was. Broadest, and most often nearly-right. |

Computing it rather than declaring it means adding a rule can't accidentally
outrank a narrower one just because it was added later. The `× 10` matters
too: it guarantees a fully scoped `AKAHU_CATEGORY` rule still loses to a
completely unscoped `DESCRIPTION` one, rather than scope quietly promoting a
rule past another field's tier.

Worked example — `IAG New Zealand Limi State Insura # Lans#`:

- `DESCRIPTION` contains `state insura # lans` → `Rental — Insurance` ✅
- would otherwise fall to `MERCHANT = IAG` → `Insurance — Motor` ✗

**Book scoping is implicit, and it turned out to be enough.** The design
assumed PayPal would need explicit `accountId` scoping to mean two different
things. It doesn't: the matcher refuses to assign a category from a different
book than the transaction's account, so a rule on a BUSINESS category can
never see a PERSONAL transaction. `PAYPAL *SHOPIFYCOMM` → business
`Platform & Subscription Fees`, and personal PayPal falls to
`MERCHANT = PayPal` → `Household & General Retail`, with no scoping at all.

`accountId` scoping is kept on `CategoryRule` because a second business
account would need it, but nothing in the current rule set uses it. What does
get used is `direction`: the same payee is a home-office power cost on the way
out and a refund on the way in.

A transaction that matches nothing keeps `categoryId = null` and appears in the
review queue. Null is honest; an `Uncategorised` catch-all category would hide
the problem inside a legitimate-looking bucket.

**Book safety** is enforced in the matcher rather than by each caller, asserted
in unit tests, and re-checked against stored data by
`categories:seed --verify`. The bulk re-categoriser has its own copy of the
check, because it's the one path that bypasses the matcher entirely.

---

## 6. The category list

63 categories as built (the design sketch said 55; the extra ones are listed
below). Every one is justified by rows in the baseline except `Owner
Drawings`, `Rental — Repairs & Maintenance`, `Rental — Management Fees` and
the business `Internal Transfer`, which exist because the reports need them
and their absence would be a silent gap rather than an empty row.

Two changes from the sketch, both made while writing the rules:

- **`Insurance Claims & Refunds` became `Refunds & Claims`.** The bucket also
  has to hold a Contact Energy overpayment and a Spark rebate, which aren't
  insurance. The narrower name would have quietly encouraged filing them
  somewhere worse.
- **`Cash Withdrawals` added.** $3,870 of ATM cash across 16 withdrawals.
  Where it went is genuinely unknowable from a bank feed, so it gets its own
  category rather than being guessed into one — and it's exactly what the
  `MANUAL` transaction source exists for later.

### PERSONAL — income

| Category | Kind | TaxTag | Seeded from |
|---|---|---|---|
| Salary & Wages | INCOME | TAXABLE_INCOME | `energy solution prov` |
| Income Protection Claims | INCOME | TAXABLE_INCOME | `aia nz aianz clm#` — $47,555 |
| Benefit & Support | INCOME | TAXABLE_INCOME | `w&i benefit t goodman` |
| Rental Income — Cashel St | INCOME | RENTAL_INCOME | `a j mcpherson # cashel landlord pay ray white` |
| Flatmate Contributions | INCOME | — | `thomas,bonnie rent`, `thomas,bonnie utilities` |
| Insurance Claims & Refunds | INCOME | — | `southern cross healt`, `waitemata endosco ... refund`, `spark nz trading` |
| Investment & KiwiSaver Withdrawals | INCOME | — | `nz funds kiwisave`, `nzfm redem`, `swyftx pty limited` |
| Interest Received | INCOME | — | `gross cr interest` |
| Gifts & Personal Receipts | INCOME | — | `k n goodman bd gift`, `g j sizoo`, `mr m w longden`, `mrs e j neilson`, `metal rec limit` |
| Reimbursements & Shared Costs | INCOME | — | *no rule — review queue* |
| Loan Repayments Received | INCOME | — | *no rule — review queue* |

### PERSONAL — rental expenses, all `RENTAL_EXPENSE`

| Category | Seeded from |
|---|---|
| Rental — Mortgage Payments | `asb home loan go home loan cashel st`, `sovereign account go home loan` |
| Rental — Rates | `chc cc rates` |
| Rental — Body Corporate | `strata title admin # unit 3` |
| Rental — Insurance | `state insura` + `lans` |
| Rental — Professional Fees | `valu it asset apprai` |
| Rental — Repairs & Maintenance | *none yet* |
| Rental — Management Fees | *none yet — Phase 4 gross-up* |

> **Flag for Garreth:** `Rental — Mortgage Payments` is the whole repayment.
> Only the interest portion is deductible and the bank feed cannot split it —
> that needs the ASB loan statement. The IR3 pack must say so rather than
> report the total as a deduction.

### PERSONAL — home office eligible, all `HOME_OFFICE`

| Category | Seeded from |
|---|---|
| Home Rent | `blue fern property tg goodman t#` — $37,800 |
| Home Power | merchant `Contact Energy` |
| Home Internet & Phone | merchants `Spark`, `360Net` |
| Home Water | `blue fern property tg goodman water` |

The tag means *eligible for the 12.57% apportionment*, not *deductible in
full*. These stay ordinary personal living costs in every other view. Note the
apportionment belongs to the business but the costs sit in the personal book —
that's correct, and the Phase 4 report reads across the tag, not the book.

### PERSONAL — other expenses (no taxTag)

Groceries · Takeaways & Cafes · Household & General Retail · Hardware & DIY ·
Electronics & Appliances · Insurance — Motor · Insurance — Home & Contents ·
Insurance — Health · Insurance — Pet · Vehicle — Fuel · Vehicle — Servicing &
Parts · Vehicle — Registration & Road · Transport — Other · Health & Medical ·
Vet & Pet · Subscriptions & Software · Vaping & Tobacco · Entertainment &
Leisure · Clothing & Personal · Accounting & Professional Fees · Bank Fees &
Interest · BNPL — Afterpay · BNPL — Finance Now · Waste & Council Services ·
Gifts & Donations · Loans & Advances Made

### PERSONAL — transfer and owner

| Category | Kind | Note |
|---|---|---|
| Internal Transfer | TRANSFER | every paired ANZ leg |
| Investments & Savings | TRANSFER | Swyftx purchases — buying an asset isn't spending it |
| Owner Contribution to Business | OWNER | the personal leg of `tommy tinkers nz` — $1,630 |

### BUSINESS

| Category | Kind | TaxTag | Seeded from |
|---|---|---|---|
| Sales — Shopify | INCOME | BIZ_INCOME | `shopify trf` |
| Sales — Direct Invoice | INCOME | BIZ_INCOME | `ham radio car c`, `auckland radi airccc` |
| Sales — Other | INCOME | BIZ_INCOME | `bnz merchant nzd` |
| Platform & Subscription Fees | EXPENSE | BIZ_EXPENSE | `paypal *shopifycomm`, `microsoft#`, `cursor`, `akiflow`, `beamjobs`, `typemax` |
| Freight & Courier | EXPENSE | BIZ_EXPENSE | `gosweetspot`, `gss* inv-#` |
| Materials & Supplies | EXPENSE | BIZ_EXPENSE | `amazon marketplace`, `mitre # helensville`, `helensville paperplu` |
| Bank Fees & Interest | EXPENSE | BIZ_EXPENSE | `monthly bank fee`, `merchant service fee`, `app fee`, `02-#-#` |
| Entertainment | EXPENSE | BIZ_EXPENSE | `mcdonald's kumeu`, `bread basket bakery` |
| Owner Contribution | OWNER | — | `goodman,thoma` on the BNZ account |
| Owner Drawings | OWNER | — | *none yet* |
| Internal Transfer | TRANSFER | — | *none yet* |

> **Flag for Garreth:** business `Entertainment` is tagged `BIZ_EXPENSE` so it
> reaches the report, but NZ entertainment deductions are commonly limited to
> 50%. The report should show it as a separate line rather than fold it into
> total expenses.

**Tax-need check:**

| Plan §3 requirement | Answered by |
|---|---|
| Gross rental income and expenses (IR3) | `RENTAL_INCOME` + `RENTAL_EXPENSE`, with the net-of-fee and interest-split warnings |
| Tommy Tinkers income/expenses by deductible type (IR3) | `BIZ_INCOME` + `BIZ_EXPENSE`, six expense categories by type |
| Home office eligible costs (12.57%) | `HOME_OFFICE` across four categories |
| Running 12-month business turnover (GST) | `BIZ_INCOME` only — excludes `OWNER`, so $982.84 not $2,612.84 |

---

## 7. Transfer pair detection

Three tiers, and only the first is automatic.

### Tier 1 — ANZ `To:`/`From:`, auto-confirmed

```
To:   06-0878-0335888-03 afterpay     on the sending account
From: 06-0878-0335888-00 afterpay     on the receiving account
```

Match when: same date, `amountCents` exactly negated, the counterparty account
named in each description resolves to one of our `Account.formattedAccount`
values, **and each leg names the other's account** (reciprocal).

Measured over the baseline: **403 of 404 outgoing legs match, zero unmatched
internal legs** — 389 unambiguous plus 14 same-date/same-amount/same-pair
groups that are genuinely interchangeable. The single unmatched leg names
`01-0495-0425683-00`, which is not ours, and correctly stays unpaired.

The free-text label is a **tiebreaker only**. When ANZ generates the transfer
the label becomes `Debit Transfer 151054` / `Credit Transfer 092335` with a
per-leg reference that differs between sides; requiring label equality drops
matches from 403 to 109. Ambiguous groups are resolved by pairing in a stable
order (by transaction id) — with identical dates and amounts, every assignment
produces identical books.

Both legs get a shared `transferPairId`, `Internal Transfer`, and
`categorySource = TRANSFER`.

### Tier 2 — suggested, human confirms

Standing-order internal pairs (66 pairs, $12,114) and cross-book owner pairs
(10, $1,630). These have no structured description; the outgoing leg names the
destination account and the incoming leg is `<payer> <same particulars>`:

| From | Out | To | In | Pairs |
|---|---|---|---|---:|
| ANZ Income Bucket | `Flat Rent Payments Rent` | ANZ Flat Rent Payments | `Goodman,Thoma Rent` | 20 |
| ANZ Income Bucket | `Flat Expenses Utilities` | ANZ Flat Expenses | `Goodman,Thoma Utilities` | 18 |
| ANZ Income Bucket | `Flat Expenses Tom Phone` | ANZ Flat Expenses | `Goodman,Thoma Tom Phone` | 18 |
| ANZ Income Bucket | `Bills Bills` | ANZ My Bills | `Goodman,Thoma Bills` | 10 |
| ANZ (personal) | `Tommy Tinkers Nz` | BNZ Tommy Tinkers NZ | `GOODMAN,THOMA` | 10 |

Cross-book pairs get `transferPairId` **and** the `OWNER` categories, not
`Internal Transfer` — they must not net to zero inside one book.

### Tier 3 — never automatic

Everything else. The reason is measurable: `Flat Expenses Utilities` (a real
standing order out) collides with `Thomas,Bonnie Utilities` (real flatmate
income) on the same date at the same amount **17 times**. Auto-netting those
would erase $1,360 of income and the books would still balance, so nothing
would ever flag it.

Suggestions are computed on demand and never stored. Only confirmation writes.

**Invariant, asserted in tests:** for any `transferPairId`, the sum of
`amountCents` across its legs is exactly 0, and there are exactly two legs.

---

## 8. Tools

No UI — the transaction UI is Phase 3. Everything is a CLI script following the
existing `src/scripts/_run.ts` pattern.

| Command | Behaviour |
|---|---|
| `npm run categories:discover` | Regenerates the discovery report from the current database. Read-only. Repeatable, not a one-off — it's how the next re-shaping conversation starts. |
| `npm run categories:seed` | Creates/updates categories and rules from `src/lib/categories/definitions.ts`. Idempotent: upsert by `(name, book)`, rules replaced wholesale per category. Never deletes a category that has transactions. |
| `npm run categories:apply` | Runs the matcher. `--dry-run` prints the mapping without writing. Skips `MANUAL` rows unless `--force`. `--uncategorised` (default) or `--all`. |
| `npm run categories:review` | The review queue: uncategorised rows grouped by normalised key, ranked by count and dollar volume, with account and direction. 166 `Thomas Brett` rows are one line. |
| `npm run categories:recat` | Bulk re-categorisation. `--from <cat> --to <cat>`, or `--match <key> --to <cat>`, optionally `--account`/`--book`/`--direction`. Prints the affected count and total and requires `--confirm` to write. Sets `categorySource = MANUAL`. |
| `npm run transfers:detect` | Auto-confirms tier 1; prints tier 2 suggestions with ids. `--dry-run` supported. |
| `npm run transfers:confirm` | Confirms suggestions by id, or `--all-tier2`. |

Every writing command defaults to dry-run or requires `--confirm`. This is real
financial data and a bad bulk update is the cheapest possible way to ruin it.

---

## 9. Sync integration

`src/lib/sync/import.ts` applies the matcher to **newly inserted rows only**,
immediately after the `createMany`. Rows that match nothing stay null and
surface in the review queue. Existing rows are never touched by a sync — only
`categories:apply` does that, and only when asked.

Two Phase 1 defects get fixed here because this change touches the same code:

- `storedTotalCents` and `latestTransactionDate` don't filter by `source`. Once
  MANUAL transactions exist (the Phase 4 rental gross-up will create them),
  reconciliation gains permanent false drift and the sync high-water mark can
  skip late-posted bank rows. Both must filter `source: "AKAHU"`.
- `src/worker/index.ts` SIGTERM doesn't await an in-flight sync, so shutdown
  mid-sync leaves a `SyncRun` stuck at `RUNNING`.

---

## 10. Testing

Unit tests (pure, no database) cover:

- `normaliseDescription` — card numbers, digit runs, whitespace, idempotence,
  and specifically that it does *not* destroy the IAG policy suffix
- rule precedence — the IAG three-policy case, the PayPal two-book case, the
  refund-vs-spend direction case, and that scope can't promote a rule past
  another field's tier
- book safety — wrong-book rules rejected, unassigned accounts match nothing
- determinism — equally specific rules resolve identically regardless of input
  order
- transfer tier 1 — reciprocal match required, external account excluded,
  label mismatch tolerated, interchangeable groups resolved stably, no
  incoming leg claimed twice
- tier 2 — the flatmate collision surfaces as contested rather than resolved

Checks against the real database live in `categories:seed --verify` rather
than in the test suite, because `npm test` has to pass inside a Docker build
where there is no database. It reports:

- **rule coverage**, split three ways — matching nothing at all (usually a
  typo), shadowed by a rule pointing at the *same* category (a harmless safety
  net), and shadowed by a rule pointing at a *different* one (a bug).
- **book consistency** — every categorised transaction sits in a category from
  its own book, verified against stored data rather than trusted.
- **tax tag totals and the rolling 12-month GST turnover.**

The three-way split of rule coverage was not in the original design and was
added because the two-way version hid a real defect: the description pattern
`tommy tinker` was swallowing `Nz Safety Blackwoods Tommy Tinker P750800` — a
purchase of safety gear with the business name in the payment reference — and
filing it as capital introduced. The only symptom was an unrelated
specialty-retail rule reporting zero matches.

---

## 11. Results over the real baseline

Run against the live database, 01/08/2026, after a daily sync that brought
the total to 2,687 (the discovery report describes the 2,642-row baseline as
it stood on 27/07).

| | Transactions | |
|---|---:|---|
| Transfer legs paired and categorised | 818 | `categorySource = TRANSFER` |
| Matched by a rule | 1,382 | `categorySource = RULE` |
| Left for review | 487 | in ~70 distinct keys |
| **Total** | **2,687** | **82% categorised automatically** |

Of those left, roughly 137 are tier 2 standing-order legs waiting on
confirmation and 228 are the `Thomas Brett` stream deliberately left for Tommy
to split. The genuine long tail is about 110 transactions.

Tier 1 transfer detection paired **403 of 404** outgoing legs on the original
baseline with zero unmatched internal legs, exactly as the discovery report
predicted, and a further 6 on the next sync. The two excluded legs name
`01-0495-0425683-00`, which isn't ours. All 409 stored pairs have exactly two
legs summing to zero.

The daily sync path was verified end to end against live Akahu: of 45 newly
imported transactions, 21 were categorised on arrival and the rest went to the
review queue.

Tax tag totals:

| Tag | Transactions | Net |
|---|---:|---:|
| RENTAL_INCOME | 24 | $19,272.78 |
| RENTAL_EXPENSE | 87 | -$32,662.19 |
| BIZ_INCOME | 11 | $982.84 |
| BIZ_EXPENSE | 57 | -$2,395.55 |
| HOME_OFFICE | 97 | -$46,008.99 |
| TAXABLE_INCOME | 34 | $55,266.64 |

**Rolling 12-month business turnover: $982.84** against the $60,000 GST
threshold — the number the design predicted, and $1,630 lower than it would
have been if owner contributions were treated as income.

## 12. Not in scope

- Any UI. Phase 3.
- The rental gross-up mechanism. Phase 4, per decision 3.
- Splitting mortgage interest from principal. Needs the loan statement.
- Backfilling the Excel archive. Frozen by decision, plan §3.
- Nightly `pg_dump`. Still absent, still the largest operational risk on real
  financial data — raised again here, to be done before Phase 3.

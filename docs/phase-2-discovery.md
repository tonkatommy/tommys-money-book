# Phase 2 — Category discovery report

**Baseline:** 2,642 transactions across 11 accounts, 16/07/2025 → 24/07/2026.
**Run against:** the live database, 27/07/2026. All figures are from real Akahu
data, not fixtures.

This is the input to the category-list decision (plan §6 Phase 2). It answers:
what does the money actually do, and what can we auto-categorise from?

---

## 1. The headline: Akahu enrichment is a minority signal

| | Transactions | Has Akahu category | Has merchant | Neither |
|---|---:|---:|---:|---:|
| PERSONAL | 2,564 | 832 | 832 | 1,732 |
| BUSINESS | 78 | 24 | 24 | 54 |
| **Total** | **2,642** | **856 (32%)** | **856 (32%)** | **1,786 (68%)** |

Two things fall out of this that the implementation plan didn't assume:

1. **Merchant and category coverage are identical (856 each).** Akahu's Genie
   enrichment is all-or-nothing per transaction — if it recognised a merchant it
   also assigned a category, and if it didn't, we get neither. So there is no
   "has a merchant but no category" middle ground to exploit.

2. **Enrichment only ever fires on card spending.** Every one of the 856
   enriched rows is an outflow. Across all 50 Akahu categories the received
   column is empty. **100% of income is un-enriched**, which means Akahu's
   suggestions cannot contribute a single income category. Income categorisation
   has to come from description matching.

### But the tail is much shorter than 1,786 suggests

Normalising descriptions — strip `Card number: 4835 **** **** 3908`, collapse
runs of 3+ digits to `#`, and treat every ANZ internal transfer as one key —
collapses the 1,786 un-enriched rows to **184 distinct keys**:

| Rules | Transactions covered | % of un-enriched |
|---:|---:|---:|
| top 10 | 1,234 | 69% |
| top 25 | 1,482 | 83% |
| top 50 | 1,634 | 92% |
| top 100 | 1,702 | 95% |

So roughly **50 description patterns plus the 118 merchant names gets us to
~97% of the baseline**. Hand-categorising a 2,642-row backlog is not the job;
writing ~60 rules is.

---

## 2. Transaction types — the structural view

| Akahu type | Count | Inflow | Outflow |
|---|---:|---:|---:|
| TRANSFER | 808 | $43,365.79 | -$43,319.12 |
| EFTPOS | 778 | $113.81 | -$34,003.25 |
| PAYMENT | 430 | $38,140.00 | -$38,775.27 |
| STANDING ORDER | 169 | — | -$64,430.00 |
| DIRECT DEBIT | 132 | — | -$8,334.06 |
| CREDIT | 101 | $22,577.97 | — |
| DIRECT CREDIT | 85 | $94,392.34 | — |
| INTEREST | 54 | $0.28 | -$41.14 |
| FEE | 53 | — | -$181.00 |
| ATM | 19 | — | -$4,177.50 |
| DEBIT | 13 | — | -$4,680.00 |

`TRANSFER` inflow and outflow are within $47 of each other over twelve months —
the transfer-pair hypothesis is already visibly true at the aggregate level.

---

## 3. Akahu's suggested categories (spending only)

### PERSONAL — top 20 by count

| Group | Category | n | Spent |
|---|---|---:|---:|
| Household | General retail stores | 164 | $4,528.40 |
| Professional Services | Lending services | 124 | $8,582.00 |
| Household | Insurance | 117 | $5,249.19 |
| Lifestyle | Fast food stores | 68 | $1,942.04 |
| Food | Supermarkets and grocery stores | 53 | $3,926.04 |
| Food | Bakeries | 35 | $684.18 |
| Professional Services | Business software and cloud services | 29 | $1,180.19 |
| Lifestyle | Cigarette, vape, and other smoking | 26 | $1,044.32 |
| Household | Building supplies | 20 | $1,158.36 |
| Transport | Fuel stations | 19 | $1,050.46 |
| Utilities | Telecommunication services | 18 | $3,543.93 |
| Health | Pharmacies | 15 | $556.01 |
| Utilities | Electricity and gas services | 15 | $4,109.54 |
| Housing | Local government | 14 | $4,230.83 |
| Lifestyle | Media/entertainment streaming | 13 | $165.87 |
| Lifestyle | Cafes and restaurants | 13 | $546.86 |
| Professional Services | Personal software | 11 | $204.40 |
| Household | Electronic and appliance stores | 9 | $1,458.74 |
| Health | Physiotherapy and massage | 7 | $281.89 |
| Health | Veterinary services | 7 | $447.85 |

The remaining 28 personal categories are 1–6 transactions each and total under
$3,000 combined — a long tail that should merge into broader buckets rather
than earn its own category.

### BUSINESS — all 7

| Group | Category | n | Spent |
|---|---|---:|---:|
| Household | General retail stores | 13 | $1,121.19 |
| Professional Services | Business software and cloud services | 4 | $387.27 |
| Household | Stationery and office supplies | 2 | $47.56 |
| Lifestyle | Fast food stores | 2 | $63.00 |
| Professional Services | Courier and freight delivery | 1 | $9.63 |
| Household | Building supplies | 1 | $27.76 |
| Food | Bakeries | 1 | $22.15 |

Note "General retail stores $1,121" is almost entirely **PayPal**, which is a
payment rail, not a merchant — see §4.

---

## 4. Merchants — top by dollar volume

| Book | Merchant | Akahu category | n | Spent |
|---|---|---|---:|---:|
| PERSONAL | Afterpay | Lending services | 98 | $4,682.00 |
| PERSONAL | PayPal | General retail stores | 162 | $4,362.90 |
| PERSONAL | Contact Energy | Electricity and gas | 15 | $4,109.54 |
| PERSONAL | Christchurch City Council | Local government | 13 | $4,099.83 |
| PERSONAL | Finance Now | Lending services | 26 | $3,900.00 |
| PERSONAL | Spark | Telecommunications | 16 | $3,513.93 |
| PERSONAL | Woolworths | Supermarkets | 41 | $3,368.67 |
| PERSONAL | IAG | Insurance | 77 | $2,040.69 |
| PERSONAL | Southern Cross | Insurance | 24 | $1,779.70 |
| PERSONAL | Pacific International Insurance | Insurance | 14 | $1,395.40 |
| PERSONAL | Mitre 10 | Building supplies | 19 | $1,129.39 |
| PERSONAL | Epsomtax.com | Accountancy | 4 | $1,062.08 |
| PERSONAL | Swyftx | Managed funds | 1 | $1,000.00 |
| PERSONAL | JB Hi-Fi | Electronics | 1 | $977.16 |
| BUSINESS | PayPal | General retail stores | 12 | $968.84 |

**Three merchant names are traps** and matter more than their rank suggests:

- **PayPal (174 transactions, $5,332 across both books)** is a payment
  processor. In the business book every one of these is the monthly Shopify
  subscription (`PAYPAL *SHOPIFYCOMM`). In the personal book it's whatever was
  bought. A rule on merchant `PayPal` alone would be wrong; the description
  substring after `PAYPAL *` is the real signal.
- **IAG ($2,040, 77 transactions)** is three separate policies, distinguishable
  only by a suffix in the description:
  `...State Insura # Mots#` = motor, `...Homs#` = home, `...Lans#` = **landlord
  — a rental expense, not a personal one**. A merchant-level rule would merge a
  deductible cost into a private one.
- **Afterpay + Finance Now ($8,582, 124 transactions)** are Akahu's "Lending
  services". These are repayments of buy-now-pay-later balances, so the money
  leaves twice from the app's point of view (once at Afterpay, once when the
  goods were bought). Needs a decision — see §7.

---

## 5. Transfer pair detection

### 5a. ANZ internal transfers — deterministic, no guessing needed

Every one of the 808 `TRANSFER` rows carries a structured description:

```
To:   06-0878-0335888-03 afterpay      (on the sending account)
From: 06-0878-0335888-00 afterpay      (on the receiving account)
```

404 `To:` legs and 404 `From:` legs, perfectly symmetric, and each names the
**counterparty** account number. Nine of the eleven accounts are ANZ suffixes of
`06-0878-0335888`, all of which we already hold in `Account.formattedAccount`.

Matching on `(date, ±amount, counterparty account resolves to one of our
accounts, and reciprocally)`:

| | Outgoing legs | Unmatched | Exactly one match | Ambiguous |
|---|---:|---:|---:|---:|
| Counterparty is ours | 403 | **0** | 389 | 14 |
| Counterparty is external | 1 | 1 | 0 | 0 |

**Zero unmatched internal legs.** The 14 ambiguous cases are same-day,
same-amount, same-account-pair transfers — genuinely interchangeable, so either
assignment produces the same books. The single external one (`01-0495-0425683-00`)
is correctly left alone: it is not our account and must not be netted.

The free-text label (`afterpay`, `rent`, `tom phone`) is a useful tiebreaker but
must **not** be a match requirement — when ANZ generates the transfer itself the
label becomes `Debit Transfer 151054` / `Credit Transfer 092335` with a
per-leg reference number that differs between the two sides. Requiring label
equality drops the match rate from 403 to 109.

### 5b. Standing-order internal transfers — a second, smaller class

Money moved from the Income Bucket into the bucket accounts by standing order is
typed `STANDING ORDER` on the way out and `CREDIT` on the way in, with no
`To:`/`From:` structure:

| From | Out description | To | In description | Pairs | Value |
|---|---|---|---|---:|---:|
| ANZ Income Bucket | `Flat Rent Payments Rent` | ANZ Flat Rent Payments | `Goodman,Thoma Rent` | 20 | $8,544.00 |
| ANZ Income Bucket | `Flat Expenses Utilities` | ANZ Flat Expenses | `Goodman,Thoma Utilities` | 18 | $1,440.00 |
| ANZ Income Bucket | `Flat Expenses Tom Phone` | ANZ Flat Expenses | `Goodman,Thoma Tom Phone` | 18 | $630.00 |
| ANZ Income Bucket | `Bills Bills` | ANZ My Bills | `Goodman,Thoma Bills` | 10 | $1,500.00 |

66 pairs, $12,114. The outgoing description begins with the destination
account's name and the incoming one is `<payer name> <same particulars>`.

### 5c. Cross-book: owner contributions

| From | Out | To | In | Pairs | Value |
|---|---|---|---|---:|---:|
| ANZ (personal) | `Tommy Tinkers Nz` | BNZ Tommy Tinkers NZ | `GOODMAN,THOMA` | 10 | $1,630.00 |

These pair the same way but cross the personal/business boundary. They are
`OWNER` kind, not `TRANSFER` — the business received capital, and it must not
appear as business income on the IR3.

### 5d. Why same-day ±amount matching alone is not safe

Blind same-day ±amount matching across accounts produces 933 candidate pairs,
and some are pure coincidence:

- `Flat Expenses Utilities` (standing order out, $80) matches **both** the real
  `Goodman,Thoma Utilities` leg **and** `Thomas,Bonnie Utilities` — a genuine
  income payment from the flatmate that happens to be the same amount on the
  same day, **17 times**. Auto-netting that would erase $1,360 of real income.
- `Vape N Ville` EFTPOS ↔ `Thomas Brett` payment, $90. Coincidence.
- `Openai *Chat` EFTPOS ↔ `Thomas Brett` payment, $40. Coincidence.

Breakdown of blind matching by type (outgoing legs, ±2 day window):

| Type | No match | Exactly one | Ambiguous |
|---|---:|---:|---:|
| TRANSFER | 1 | 252 | 151 |
| STANDING ORDER | 92 | 58 | 19 |
| PAYMENT | 154 | 25 | 8 |
| EFTPOS | 768 | 6 | 0 |
| everything else | 258 | 0 | 1 |

**Conclusion: 5a is safe to auto-confirm. 5b, 5c, and anything else must be
suggestions a human confirms.**

---

## 6. What the money actually does

### Income (all un-enriched — Akahu contributes nothing here)

| Description pattern | n | Net | What it looks like |
|---|---:|---:|---|
| `Aia Nz Aianz Clm#` | 20 | $47,555.45 | AIA insurance claim payments |
| `Thomas Brett` | 166 | $20,972.50 | frequent small payments in |
| `A J Mcpherson 3-# Cashel Landlord Pay Ray White` | 24 | $19,272.78 | **rental income**, Cashel St, via Ray White |
| `Nz Funds Kiwisave Financial Ha` | 1 | $16,000.00 | KiwiSaver withdrawal |
| `Thomas,Bonnie Rent. 2 Wks Rent` | 27 | $11,299.00 | flatmate rent |
| `W&I Benefit T Goodman` | 13 | $5,651.20 | Work and Income benefit |
| `Mr M W Longden And Ml` | 7 | $2,800.00 | — |
| `Thomas,Bonnie Utilities` | 27 | $2,160.00 | flatmate utilities share |
| `Energy Solution Prov` | 1 | $2,059.99 | — |
| `Metal Rec Limit Scrap Metail` | 1 | $1,000.00 | scrap metal sale |
| `Nzfm Redem Nz Funds Sellstp` | 1 | $1,000.00 | managed fund redemption |
| `Spark Nz Trading` | 3 | $690.76 | refund/rebate |
| `K N Goodman Bd Gift` | 1 | $550.00 | gift |
| `Southern Cross Healt` | 5 | $396.62 | health insurance claim refunds |

### Rental property — Cashel St, Unit 3, Christchurch

| Description | Type | n | Net |
|---|---|---:|---:|
| `A J Mcpherson 3-# Cashel Landlord Pay Ray White` | DIRECT CREDIT | 24 | **$19,272.78** |
| `Asb Home Loan Go Home Loan Cashel St` | PAYMENT | 11 | -$13,037.11 |
| `Sovereign Account Go Home Loan Cashel St` | STANDING ORDER / DEBIT | 13 | -$11,810.00 |
| `Strata Title Admin # Unit 3` | PAYMENT / SO / DEBIT | 16 | -$5,755.37 |
| `Chc Cc Rates` | PAYMENT / SO / DEBIT | 14 | -$4,199.83 |
| `Valu It Asset Apprai T.Goodman 3/# Cashel` | PAYMENT | 1 | -$546.25 |
| `Iag New Zealand Limi State Insura # Lans#` | DIRECT DEBIT | 26 | -$403.63 |
| Sovereign / Strata / rates reversals | CREDIT | 6 | +$3,090.00 |

Every one of these runs through **ANZ Income Bucket**, mixed in with personal
income and spending. There is no dedicated rental account, so the rental
ring-fence has to be done by category, not by account.

### Home office — the 12.57% eligible costs

Costs at the place Tommy lives (not the rental):

| Description | n | Spent |
|---|---:|---:|
| `Blue Fern Property Tg Goodman T#` (rent) | 54 | $37,800.00 |
| Contact Energy (power) | 15 | $4,109.54 |
| Spark (phone/broadband) | 16 | $3,513.93 |
| `Blue Fern Property Tg Goodman Water T#` | 8 | $414.15 |
| 360Net (internet) | 1 | $121.37 |

### Business — Tommy Tinkers NZ (BNZ, 78 transactions)

A Shopify store selling stickers/decals, plus direct club invoices.

**Income (excluding owner contributions):**

| Source | n | Total |
|---|---:|---:|
| `Shopify TRF <ref>` payouts | 8 | $352.74 |
| `Ham Radio Car C HRCCC 26 Nationals Inv #D7` | 1 | $370.00 |
| `Auckland Radi AIRCCC Stickers Masters` | 1 | $260.00 |
| `BNZ Merchant NZD` | 1 | $0.10 |

**Rolling 12-month turnover: $982.84** — against a $60,000 GST registration
threshold. Not close, but the monitor still has to exist and has to exclude the
$1,630 of owner contributions, or it would report $2,612.

**Expenses:**

| Item | n | Total |
|---|---:|---:|
| `PAYPAL *SHOPIFYCOMM` (Shopify subscription) | 12 | $968.84 |
| `AKIFLOW INC` | 1 | $365.03 |
| `MICROSOFT#G127902209` | 1 | $278.76 |
| `SUPPORT@BEAMJOBS.COM` / `BEAMJOBS* TRIAL OVER` | 4 | $185.75 |
| `CURSOR, AI POWERED I` | 3 | $108.51 |
| `AMAZON MARKETPLACE A` | 1 | $152.35 |
| `GSS* INV-#` / `GOSWEETSPOT` (courier) | 5 | $74.93 |
| `MONTHLY BANK FEE` + `MERCHANT SERVICE FEE` + app fee | 12 | $65.00 |
| `02-0139-0152818-00` (overdraft interest) | 11 | $34.12 |
| `HELENSVILLE PAPERPLU` (Paper Plus) | 2 | $47.56 |
| `MITRE 10 HELENSVILLE` | 1 | $27.76 |
| McDonald's / Bread Basket | 3 | $85.15 |

The business ran at a loss both years: FY2026 $1,362.84 in / $1,765.62 out,
FY2027 to date $1,250.00 in / $629.93 out.

---

## 7. Open decisions this report can't make

These need Tommy's answer before the category list can be finalised:

1. **`Thomas Brett` / `Brett Thomas` — 166 in ($20,972), 62 out ($3,808).**
   The largest un-enriched income stream and completely opaque from the bank
   data. Income? A loan? Shared costs? `Brett Thomas Brett Loan` and
   `Brett Thomas Loan` suggest lending, and 4 same-day ±amount matches suggest
   some of it is reimbursement rather than income.
2. **Flatmate income — `Thomas,Bonnie Rent` $11,299 + `Utilities` $2,160.**
   Cost-sharing between flatmates is generally outside the tax net; genuine
   sublet rental income is not. This determines whether it needs a
   `RENTAL_INCOME` tag or a non-taxable bucket.
3. **Gross vs net rental income.** The $19,272.78 from Ray White is almost
   certainly **net** of the management fee. The IR3 wants **gross** rent with the
   fee as a deductible expense. The bank feed can't see the difference — the
   Ray White statements can. Does the app need a manual adjustment mechanism,
   or does this get reconciled at year end outside the app?
4. **`Sovereign Account Go Home Loan Cashel St` — $11,810 out, $2,790 of
   reversals.** Second mortgage, insurance premium, or something else? It
   changes whether it is a rental interest deduction or capital.
5. **Afterpay and Finance Now — $8,582 across 124 transactions.** Do we treat
   the repayment as the expense (simple, but the category is "Lending services"
   and tells us nothing about what was bought), or the original purchase?
6. **`Mr M W Longden And Ml` $2,800, `Mrs E J Neilson And ...` $899,
   `Mr C J Longden Car Parts` $220, `Energy Solution Prov` $2,059.99,
   `Metal Rec Limit Scrap Metail` $1,000.** Personal, or unbanked Tommy Tinkers
   trading that should be in the business book?
7. **`ANZ Freelancing` account (23 transactions, all internal transfers and
   overdraft fees).** No freelancing income ever landed here. Keep it mapped as
   PERSONAL, or is it dormant?

---

## 8. Outstanding operational item — resolved 01/08/2026

`ANZ Money Card` drift was **-$121.23** on 27/07 and **-$233.02** by 01/08. The
conclusion recorded here — "a persistent gap means the account is missing rows
Akahu never returned" — was **wrong**, and worth leaving in place as a record
of how the evidence read at the time.

Every stored row on that account forms an unbroken chain against Akahu's own
per-transaction running balance; the only two discontinuities are on
2025-07-16, the first day of history, which is a boundary artefact. Nothing
was missing.

The real cause: ANZ's reported `current` balance already reflects card
authorisations that haven't settled, while the transaction feed returns settled
rows only. Akahu's pending endpoint listed ten authorisations totalling exactly
-$233.02. The reconciliation was comparing settled money against a balance that
included unsettled money, so any account with live card activity showed
permanent drift.

Fixed by fetching pending totals and subtracting them. All 11 accounts now
reconcile to zero.

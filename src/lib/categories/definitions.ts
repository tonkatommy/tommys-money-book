// The category list and its auto-categorisation rules.
//
// This file is the decision, in code. It was built bottom-up from the real
// baseline (docs/phase-2-discovery.md) rather than from a pre-drawn chart of
// accounts, and every rule below matches at least one transaction that
// actually exists — `categories:seed --verify` fails the build if one doesn't,
// because a rule matching nothing is a typo nobody would otherwise notice.
//
// How to change it: edit here, run `npm run categories:seed`, then
// `npm run categories:apply` (dry by default) to preview changes. Seeding is idempotent — categories are
// deleting a rule here deletes it from the database. A category that already
// has transactions is never deleted.
//
// Two things to understand before adding a rule:
//
//   1. Book scoping is implicit. A rule attached to a BUSINESS category can
//      only ever match a transaction on a BUSINESS account, because the
//      matcher refuses to cross books. That is why "PayPal" can safely mean
//      the Shopify subscription in one book and general retail in the other
//      without any explicit scoping.
//
//   2. DESCRIPTION patterns are substrings of the *normalised* description
//      (see normalise.ts), so they must be lower-case and have runs of 3+
//      digits already collapsed to "#". `state insura # lans` is a real
//      pattern; `State Insura 4155 Lans01` would never match anything.

import type {
  Book,
  Kind,
  RuleDirection,
  RuleField,
  TaxTag,
} from "@/generated/prisma/client";

export type RuleDefinition = {
  field: RuleField;
  /** Lower-cased. For DESCRIPTION, already normalised. */
  pattern: string;
  direction?: RuleDirection;
  /** Account *name*, resolved to an id at seed time. Rarely needed. */
  accountName?: string;
  priority?: number;
  note?: string;
};

export type CategoryDefinition = {
  name: string;
  book: Book;
  kind: Kind;
  taxTag?: TaxTag;
  /** Why this category exists, when the name doesn't say it. */
  note?: string;
  rules?: RuleDefinition[];
};

const D = "DESCRIPTION" as const;
const M = "MERCHANT" as const;
const A = "AKAHU_CATEGORY" as const;

export const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  // ===========================================================================
  // PERSONAL — income
  // ===========================================================================
  {
    name: "Salary & Wages",
    book: "PERSONAL",
    kind: "INCOME",
    taxTag: "TAXABLE_INCOME",
    note:
      "Energy Solution Providers, from 20/07/2026. One payment in the " +
      "baseline because the job had just started — this becomes the dominant " +
      "FY2027 income category.",
    rules: [{ field: D, pattern: "energy solution prov", direction: "IN" }],
  },
  {
    name: "Income Protection Claims",
    book: "PERSONAL",
    kind: "INCOME",
    taxTag: "TAXABLE_INCOME",
    note:
      "AIA, $47,555 over 20 payments — the largest single income stream in " +
      "the baseline. Taxable per Tommy (27/07/2026); confirm with Garreth " +
      "before the first IR3, because lump-sum trauma/TPD would not be.",
    rules: [{ field: D, pattern: "aia nz aianz", direction: "IN" }],
  },
  {
    name: "Benefit & Support",
    book: "PERSONAL",
    kind: "INCOME",
    taxTag: "TAXABLE_INCOME",
    rules: [{ field: D, pattern: "w&i benefit", direction: "IN" }],
  },
  {
    name: "Rental Income — Cashel St",
    book: "PERSONAL",
    kind: "INCOME",
    taxTag: "RENTAL_INCOME",
    note:
      "Paid by Ray White as property manager. NET of their management fee — " +
      "the IR3 needs GROSS rent with the fee as a separate deduction, and " +
      "the bank feed cannot see the difference. See docs/phase-2-design.md §2.",
    rules: [{ field: D, pattern: "cashel landlord pay", direction: "IN" }],
  },
  {
    name: "Flatmate Contributions",
    book: "PERSONAL",
    kind: "INCOME",
    note:
      "Cost-sharing, not taxable income (Tommy, 27/07/2026) — contributions " +
      "toward rent and power already paid on the Blue Fern tenancy. " +
      "Deliberately untagged so it never reaches the IR3.",
    rules: [
      {
        field: D,
        pattern: "thomas,bonnie",
        direction: "IN",
        note:
          "Comma-first is the bank's payer format and is what separates these " +
          "incoming contributions from the 'bonnie thomas ...' payments going " +
          "the other way.",
      },
    ],
  },
  {
    name: "Refunds & Claims",
    book: "PERSONAL",
    kind: "INCOME",
    note:
      "Money coming back rather than money earned: insurance claims, " +
      "overpaid utilities, medical refunds. Untagged — a refund is not income.",
    rules: [
      { field: D, pattern: "southern cross healt", direction: "IN" },
      { field: D, pattern: "southern cross claim refund", direction: "IN" },
      { field: D, pattern: "waitemata endosco", direction: "IN" },
      { field: D, pattern: "waitemata en - (reversal)", direction: "IN" },
      { field: D, pattern: "pd pet insurance", direction: "IN" },
      { field: D, pattern: "spark nz trading", direction: "IN" },
      {
        field: D,
        pattern: "contact energy",
        direction: "IN",
        note:
          "Direction is doing real work here: the same payee is a home-office " +
          "power cost on the way out and a refund on the way in.",
      },
      { field: D, pattern: "iag new zealand limi", direction: "IN" },
      { field: M, pattern: "southern cross", direction: "IN" },
      { field: M, pattern: "iag", direction: "IN" },
    ],
  },
  {
    name: "Investment & KiwiSaver Withdrawals",
    book: "PERSONAL",
    kind: "INCOME",
    note:
      "Withdrawing your own capital is not income — untagged on purpose. " +
      "$16,000 NZ Funds KiwiSaver withdrawal plus two smaller redemptions.",
    rules: [
      { field: D, pattern: "nz funds kiwisave", direction: "IN" },
      { field: D, pattern: "nzfm redem", direction: "IN" },
      { field: D, pattern: "swyftx pty limited", direction: "IN" },
    ],
  },
  {
    name: "Interest Received",
    book: "PERSONAL",
    kind: "INCOME",
    rules: [
      {
        field: D,
        pattern: "gross cr interest",
        direction: "IN",
        note:
          "ANZ puts the amount in the description, so every row is a distinct " +
          "key. Anchoring on the fixed prefix collapses all twelve of them.",
      },
    ],
  },
  {
    name: "Gifts & Personal Receipts",
    book: "PERSONAL",
    kind: "INCOME",
    note: "Personal, non-taxable receipts (Tommy, 27/07/2026).",
    rules: [
      { field: D, pattern: "k n goodman bd gift", direction: "IN" },
      { field: D, pattern: "g j sizoo", direction: "IN" },
      { field: D, pattern: "mr m w longden", direction: "IN" },
      { field: D, pattern: "mr c j longden", direction: "IN" },
      { field: D, pattern: "mrs e j neilson", direction: "IN" },
      { field: D, pattern: "mr t i hutchinson", direction: "IN" },
      { field: D, pattern: "metal rec limit", direction: "IN" },
    ],
  },
  {
    name: "Reimbursements & Shared Costs",
    book: "PERSONAL",
    kind: "INCOME",
    note:
      "No rules on purpose. The 'Thomas Brett' stream (166 in, $20,972) is a " +
      "mix of reimbursement, lending and possibly income, and Tommy splits " +
      "it by hand — a rule would guess, and guessing wrong on the largest " +
      "un-enriched stream in the book is worse than leaving it in the queue.",
  },
  {
    name: "Loan Repayments Received",
    book: "PERSONAL",
    kind: "INCOME",
    note: "See Reimbursements & Shared Costs — split by hand, no rules.",
  },

  // ===========================================================================
  // PERSONAL — rental expenses (Cashel St, Unit 3, Christchurch)
  // ===========================================================================
  {
    name: "Rental — Mortgage Payments",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "RENTAL_EXPENSE",
    note:
      "The WHOLE repayment, not just the interest. Only interest is " +
      "deductible and the bank feed cannot split it — that needs the ASB " +
      "loan statement. The IR3 pack must say so rather than claim the total.",
    rules: [
      { field: D, pattern: "asb home loan", direction: "OUT" },
      { field: D, pattern: "sovereign account go home loan", direction: "OUT" },
      {
        field: D,
        pattern: "sovereign ac - (reversal)",
        direction: "IN",
        note: "Failed direct debits coming back — must reduce the expense.",
      },
    ],
  },
  {
    name: "Rental — Rates",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "RENTAL_EXPENSE",
    rules: [
      {
        field: D,
        pattern: "chc cc rates",
        note:
          "No direction: the pattern catches the payments and the reversals, " +
          "and both belong in the same category with opposite signs.",
      },
      { field: M, pattern: "christchurch city council" },
    ],
  },
  {
    name: "Rental — Body Corporate",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "RENTAL_EXPENSE",
    rules: [{ field: D, pattern: "strata title" }],
  },
  {
    name: "Rental — Insurance",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "RENTAL_EXPENSE",
    rules: [
      {
        field: D,
        pattern: "state insura # lans",
        note:
          "The single most consequential pattern in this file. IAG bills " +
          "three policies from one merchant and only the 'Lans' (landlord) " +
          "one is deductible — a merchant-level rule would silently move a " +
          "rental deduction into personal motor insurance.",
      },
    ],
  },
  {
    name: "Rental — Professional Fees",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "RENTAL_EXPENSE",
    rules: [
      {
        field: D,
        pattern: "valu it asset apprai",
        direction: "OUT",
        note: "Chattels valuation — the basis for depreciation claims.",
      },
    ],
  },
  {
    name: "Rental — Repairs & Maintenance",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "RENTAL_EXPENSE",
    note:
      "No baseline rows. Exists because the IR3 needs the line and an absent " +
      "category is a silent gap, where an empty one is an obvious zero.",
  },
  {
    name: "Rental — Management Fees",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "RENTAL_EXPENSE",
    note:
      "No baseline rows — Ray White nets its fee off the rent before paying, " +
      "so it never appears as a transaction. This is where the Phase 4 " +
      "gross-up entries land.",
  },

  // ===========================================================================
  // PERSONAL — home office eligible (12.57% apportionment)
  // ===========================================================================
  // The tag means "eligible for apportionment", not "deductible in full".
  // These are ordinary living costs in every other view. Note they sit in the
  // PERSONAL book while the deduction belongs to the business — that's
  // correct, and the Phase 4 report reads across the tag, not the book.
  {
    name: "Home Rent",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "HOME_OFFICE",
    rules: [
      {
        field: D,
        pattern: "blue fern property tg goodman t#",
        direction: "OUT",
        note:
          "Ends at 't#' so it does NOT catch the water bills, whose key is " +
          "'... goodman water t#'. Rent and water are separate eligible costs.",
      },
    ],
  },
  {
    name: "Home Power",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "HOME_OFFICE",
    rules: [{ field: M, pattern: "contact energy", direction: "OUT" }],
  },
  {
    name: "Home Internet & Phone",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "HOME_OFFICE",
    rules: [
      { field: M, pattern: "spark", direction: "OUT" },
      { field: M, pattern: "360net" },
      { field: M, pattern: "2degrees" },
      { field: D, pattern: "2degrees", direction: "OUT" },
    ],
  },
  {
    name: "Home Water",
    book: "PERSONAL",
    kind: "EXPENSE",
    taxTag: "HOME_OFFICE",
    rules: [
      {
        field: D,
        pattern: "blue fern property tg goodman water",
        direction: "OUT",
      },
    ],
  },

  // ===========================================================================
  // PERSONAL — everyday expenses
  // ===========================================================================
  {
    name: "Groceries",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "supermarkets and grocery stores" },
      { field: A, pattern: "convenience stores" },
    ],
  },
  {
    name: "Takeaways & Cafes",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "fast food stores" },
      { field: A, pattern: "cafes and restaurants" },
      { field: A, pattern: "bakeries" },
      { field: A, pattern: "caterers" },
    ],
  },
  {
    name: "Household & General Retail",
    book: "PERSONAL",
    kind: "EXPENSE",
    note:
      "The catch-all for card spending Akahu can only describe as retail — " +
      "162 PayPal rows land here, which is honest rather than precise. " +
      "Splitting it further needs the PayPal statement, not the bank feed.",
    rules: [
      { field: A, pattern: "general retail stores" },
      { field: A, pattern: "variety stores" },
      { field: A, pattern: "specialty retail stores (not elsewhere classified)" },
      { field: A, pattern: "home furnishing and repair stores" },
      { field: A, pattern: "nurseries and garden supplies" },
      { field: A, pattern: "hospices" },
    ],
  },
  {
    name: "Hardware & DIY",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [{ field: A, pattern: "building supplies" }],
  },
  {
    name: "Electronics & Appliances",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [{ field: A, pattern: "electronic and appliance stores" }],
  },
  {
    name: "Insurance — Motor",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [{ field: D, pattern: "state insura # mots" }],
  },
  {
    name: "Insurance — Home & Contents",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: D, pattern: "state insura # homs" },
      {
        field: M,
        pattern: "state insurance",
        direction: "OUT",
        note:
          "A merchant rule, not a description one: the bare 'state insura' " +
          "text also appears inside every IAG row, so a description pattern " +
          "would swallow the motor and landlord policies too.",
      },
    ],
  },
  {
    name: "Insurance — Health",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: M, pattern: "southern cross", direction: "OUT" },
      { field: D, pattern: "southern cro", direction: "OUT" },
    ],
  },
  {
    name: "Insurance — Pet",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: M, pattern: "pacific international insurance", direction: "OUT" },
    ],
  },
  {
    name: "Vehicle — Fuel",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [{ field: A, pattern: "fuel stations" }],
  },
  {
    name: "Vehicle — Servicing & Parts",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "automotive parts and accessories" },
      { field: A, pattern: "automotive repair and servicing" },
    ],
  },
  {
    name: "Vehicle — Registration & Road",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "transport services (not elsewhere classified)" },
      { field: D, pattern: "registration" },
    ],
  },
  {
    name: "Transport — Other",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "taxi, rideshare, and on-demand transport services" },
      { field: A, pattern: "bus and shuttle transport services" },
      { field: A, pattern: "bicycle stores, rentals, and repairs" },
    ],
  },
  {
    name: "Health & Medical",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "pharmacies" },
      { field: A, pattern: "doctors and physicians" },
      { field: A, pattern: "physiotherapy and massage therapy" },
      { field: D, pattern: "waitemata endo t. goodman", direction: "OUT" },
      { field: D, pattern: "dr clayton chan", direction: "OUT" },
      { field: D, pattern: "mandie psych", direction: "OUT" },
      { field: D, pattern: "nwmc", direction: "OUT" },
    ],
  },
  {
    name: "Vet & Pet",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [{ field: A, pattern: "veterinary services" }],
  },
  {
    name: "Subscriptions & Software",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "business software and cloud services" },
      { field: A, pattern: "personal software (not elsewhere classified)" },
      { field: A, pattern: "media and entertainment streaming services" },
      // Foreign-currency card rows Akahu never enriched. The bank puts the
      // converted amount in the description, so each is a unique key —
      // anchoring on the vendor prefix collapses them.
      { field: D, pattern: "scribd", direction: "OUT" },
      { field: D, pattern: "bark.us", direction: "OUT" },
      { field: D, pattern: "kickresume", direction: "OUT" },
      { field: D, pattern: "mmhmm.app", direction: "OUT" },
      { field: D, pattern: "cftools", direction: "OUT" },
      { field: D, pattern: "anoma.ly", direction: "OUT" },
      { field: D, pattern: "ring solo", direction: "OUT" },
    ],
  },
  {
    name: "Vaping & Tobacco",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "cigarette, vape, and other smoking products" },
      { field: D, pattern: "tramway vape", direction: "OUT" },
    ],
  },
  {
    name: "Entertainment & Leisure",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "digital gaming products and services" },
      { field: A, pattern: "liquor stores" },
      { field: A, pattern: "wineries, breweries, and distilleries" },
      { field: A, pattern: "sports and athletic clubs" },
      { field: A, pattern: "gyms, fitness, aquatic facilities, yoga, pilates" },
      { field: A, pattern: "sports equipment and supplies" },
      {
        field: A,
        pattern:
          "attractions, museums, zoos, amusement parks, circuses, exhibits",
      },
      { field: A, pattern: "hotels, motels, and other temporary accommodation" },
      {
        field: D,
        pattern: "airccc",
        direction: "OUT",
        note:
          "Radio control car club entry fees — the hobby side. Note the " +
          "BUSINESS book has AIRCCC money coming IN: that's Tommy Tinkers " +
          "selling stickers to the same club, and it is business income.",
      },
      { field: D, pattern: "hrccc", direction: "OUT" },
      { field: D, pattern: "hp fitness ltd", direction: "OUT" },
      { field: D, pattern: "gamers outle", direction: "OUT" },
    ],
  },
  {
    name: "Clothing & Personal",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [{ field: A, pattern: "clothing stores" }],
  },
  {
    name: "Accounting & Professional Fees",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      {
        field: A,
        pattern: "accountancy, bookkeeping, auditing, and tax services",
      },
      { field: D, pattern: "epsomtax", direction: "OUT" },
    ],
  },
  {
    name: "Bank Fees & Interest",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: D, pattern: "unarranged overdraft fee", direction: "OUT" },
      { field: D, pattern: "debit interest", direction: "OUT" },
    ],
  },
  {
    name: "Cash Withdrawals",
    book: "PERSONAL",
    kind: "EXPENSE",
    note:
      "$3,870 of ATM cash. Where it went is genuinely unknowable from a bank " +
      "feed, so it gets its own category rather than being guessed into one — " +
      "and it is exactly what the MANUAL transaction source exists for.",
    rules: [
      { field: D, pattern: "asb helensvi", direction: "OUT" },
      { field: D, pattern: "silverdale b", direction: "OUT" },
      { field: D, pattern: "bnz bnz#", direction: "OUT" },
    ],
  },
  {
    name: "BNPL — Afterpay",
    book: "PERSONAL",
    kind: "EXPENSE",
    note:
      "Repayment is the expense, split by lender (Tommy, 27/07/2026). Only " +
      "a MERCHANT rule: a description pattern for 'afterpay' would also " +
      "match the internal transfer legs labelled 'To: 06-...-03 afterpay' " +
      "and turn a transfer into an expense.",
    rules: [{ field: M, pattern: "afterpay" }],
  },
  {
    name: "BNPL — Finance Now",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: M, pattern: "finance now" },
      { field: D, pattern: "finance now" },
    ],
  },
  {
    name: "Waste & Council Services",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "waste and recycling services" },
      {
        field: M,
        pattern: "auckland council",
        note:
          "Auckland Council is where Tommy lives; Christchurch City Council " +
          "is the rental's rates. Same Akahu category, different books of " +
          "account — which is why there is no rule on 'local government'.",
      },
    ],
  },
  {
    name: "Gifts & Donations",
    book: "PERSONAL",
    kind: "EXPENSE",
    rules: [
      { field: A, pattern: "gift and souvenir stores" },
      { field: D, pattern: "vaughn gift", direction: "OUT" },
    ],
  },
  {
    name: "Loans & Advances Made",
    book: "PERSONAL",
    kind: "EXPENSE",
    note: "The outgoing half of the Thomas Brett split. No rules — by hand.",
  },

  // ===========================================================================
  // PERSONAL — transfer and owner
  // ===========================================================================
  {
    name: "Internal Transfer",
    book: "PERSONAL",
    kind: "TRANSFER",
    note:
      "Assigned by `transfers:detect`, never by a rule. Both legs of a pair " +
      "share a transferPairId and sum to exactly zero.",
  },
  {
    name: "Investments & Savings",
    book: "PERSONAL",
    kind: "TRANSFER",
    note:
      "TRANSFER, not EXPENSE: buying crypto or units moves money into an " +
      "asset you still own. Counting it as spending would overstate expenses " +
      "and understate net worth at the same time.",
    rules: [
      {
        field: A,
        pattern: "financial asset brokers, exchanges, and managed funds",
      },
      { field: D, pattern: "ramp crypto", direction: "OUT" },
    ],
  },
  {
    name: "Owner Contribution to Business",
    book: "PERSONAL",
    kind: "OWNER",
    note:
      "The personal leg of money put into Tommy Tinkers. OWNER rather than " +
      "TRANSFER because it crosses the book boundary — it must not net to " +
      "zero inside the personal book, and it is not business income either.",
    rules: [
      {
        field: D,
        pattern: "tommy tinkers nz",
        direction: "OUT",
        note:
          "The full business name, not 'tommy tinker'. The shorter pattern " +
          "also matched 'Nz Safety Blackwoods Tommy Tinker P750800' — a " +
          "purchase of safety gear with the business name in the payment " +
          "reference — and filed it as capital introduced. Found by " +
          "`categories:seed --verify`, which is what that check is for.",
      },
    ],
  },

  // ===========================================================================
  // BUSINESS — Tommy Tinkers NZ
  // ===========================================================================
  {
    name: "Sales — Shopify",
    book: "BUSINESS",
    kind: "INCOME",
    taxTag: "BIZ_INCOME",
    rules: [{ field: D, pattern: "shopify trf", direction: "IN" }],
  },
  {
    name: "Sales — Direct Invoice",
    book: "BUSINESS",
    kind: "INCOME",
    taxTag: "BIZ_INCOME",
    note: "Clubs invoiced directly for sticker and decal work.",
    rules: [
      { field: D, pattern: "ham radio car c", direction: "IN" },
      { field: D, pattern: "auckland radi airccc", direction: "IN" },
    ],
  },
  {
    name: "Sales — Other",
    book: "BUSINESS",
    kind: "INCOME",
    taxTag: "BIZ_INCOME",
    rules: [{ field: D, pattern: "bnz merchant nzd", direction: "IN" }],
  },
  {
    name: "Platform & Subscription Fees",
    book: "BUSINESS",
    kind: "EXPENSE",
    taxTag: "BIZ_EXPENSE",
    rules: [
      {
        field: D,
        pattern: "paypal *shopifycomm",
        direction: "OUT",
        note:
          "PayPal is a rail, not a merchant. Every business PayPal row is the " +
          "monthly Shopify subscription; the personal ones are anything at " +
          "all. A DESCRIPTION rule beats the MERCHANT tier, so this wins.",
      },
      { field: D, pattern: "akiflow", direction: "OUT" },
      { field: D, pattern: "beamjobs", direction: "OUT" },
      { field: D, pattern: "typemax", direction: "OUT" },
      { field: A, pattern: "business software and cloud services" },
    ],
  },
  {
    name: "Freight & Courier",
    book: "BUSINESS",
    kind: "EXPENSE",
    taxTag: "BIZ_EXPENSE",
    rules: [
      { field: A, pattern: "courier and freight delivery services" },
      { field: D, pattern: "gss* inv-", direction: "OUT" },
      { field: D, pattern: "gosweetspot", direction: "OUT" },
    ],
  },
  {
    name: "Materials & Supplies",
    book: "BUSINESS",
    kind: "EXPENSE",
    taxTag: "BIZ_EXPENSE",
    rules: [
      { field: A, pattern: "stationery and office supplies" },
      { field: A, pattern: "general retail stores" },
      { field: A, pattern: "building supplies" },
    ],
  },
  {
    name: "Bank Fees & Interest",
    book: "BUSINESS",
    kind: "EXPENSE",
    taxTag: "BIZ_EXPENSE",
    rules: [
      { field: D, pattern: "monthly bank fee", direction: "OUT" },
      { field: D, pattern: "merchant service fee", direction: "OUT" },
      { field: D, pattern: "app fee bnz pay", direction: "OUT" },
      {
        field: D,
        pattern: "02-#-#-00",
        direction: "OUT",
        note:
          "BNZ describes overdraft interest with the account number itself. " +
          "Safe only because rules never cross books — this pattern would be " +
          "reckless if it could reach the personal accounts.",
      },
    ],
  },
  {
    name: "Entertainment",
    book: "BUSINESS",
    kind: "EXPENSE",
    taxTag: "BIZ_EXPENSE",
    note:
      "Tagged so it reaches the report, but NZ entertainment deductions are " +
      "commonly limited to 50%. The IR3 pack shows this as its own line " +
      "rather than folding it into total expenses. Confirm with Garreth.",
    rules: [
      { field: A, pattern: "fast food stores" },
      { field: A, pattern: "bakeries" },
    ],
  },
  {
    name: "Owner Contribution",
    book: "BUSINESS",
    kind: "OWNER",
    note:
      "Capital in from Tommy — $1,630. OWNER, not income: including it would " +
      "report GST turnover of $2,612 instead of the true $983.",
    rules: [{ field: D, pattern: "goodman,thoma", direction: "IN" }],
  },
  {
    name: "Owner Drawings",
    book: "BUSINESS",
    kind: "OWNER",
    note: "No baseline rows — the business has never paid Tommy anything yet.",
  },
  {
    name: "Internal Transfer",
    book: "BUSINESS",
    kind: "TRANSFER",
    note: "No baseline rows. Exists so the business book has somewhere to put a transfer.",
  },
];

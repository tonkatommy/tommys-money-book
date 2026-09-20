// The automatic matcher: which rule wins, and which category may be attached.
//
// Two separate things are pinned here. Specificity — DESCRIPTION beats
// MERCHANT beats AKAHU_CATEGORY, and no scope may promote a rule past
// another field's tier — because a rule that swallows a more specific one
// files money under the wrong tax treatment and nothing looks broken. IAG is
// three policies and only the landlord one is deductible.
//
// And book safety: a category from the other book is never assigned, and an
// account with no book matches nothing rather than defaulting to personal.
// A book leak is invisible once written.

import { describe, expect, it } from "vitest";

import {
  matchTransaction,
  ruleSpecificity,
  sortRules,
  type MatchableRule,
  type MatchableTransaction,
} from "./match";

// Two accounts, one per book, so the book gate can actually be exercised.
const PERSONAL_ACCOUNT = "acct_personal";
const BUSINESS_ACCOUNT = "acct_business";

function rule(overrides: Partial<MatchableRule> & { id: string }): MatchableRule {
  return {
    categoryId: `cat_${overrides.id}`,
    categoryBook: "PERSONAL",
    field: "DESCRIPTION",
    pattern: "",
    accountId: null,
    direction: "ANY",
    priority: 100,
    ...overrides,
  };
}

function transaction(
  overrides: Partial<MatchableTransaction> = {},
): MatchableTransaction {
  return {
    accountId: PERSONAL_ACCOUNT,
    amountCents: -1000,
    description: "",
    merchantName: null,
    akahuCategoryName: null,
    ...overrides,
  };
}

describe("ruleSpecificity", () => {
  it("ranks DESCRIPTION above MERCHANT above AKAHU_CATEGORY", () => {
    const description = ruleSpecificity(rule({ id: "a", field: "DESCRIPTION" }));
    const merchant = ruleSpecificity(rule({ id: "b", field: "MERCHANT" }));
    const akahu = ruleSpecificity(rule({ id: "c", field: "AKAHU_CATEGORY" }));

    expect(description).toBeLessThan(merchant);
    expect(merchant).toBeLessThan(akahu);
  });

  it("never lets scope promote a rule past another field's tier", () => {
    // The guarantee the *10 multiplier buys: a fully scoped AKAHU_CATEGORY
    // rule must still lose to a completely unscoped DESCRIPTION one.
    const scopedAkahu = ruleSpecificity(
      rule({
        id: "a",
        field: "AKAHU_CATEGORY",
        accountId: PERSONAL_ACCOUNT,
        direction: "OUT",
      }),
    );
    const looseDescription = ruleSpecificity(
      rule({ id: "b", field: "DESCRIPTION" }),
    );

    expect(looseDescription).toBeLessThan(scopedAkahu);
  });
});

describe("matchTransaction — the cases that move money between tax treatments", () => {
  it("routes IAG's landlord policy to rental and its motor policy to personal", () => {
    // The single most consequential distinction in the rule set. All three
    // policies come from one merchant; only the landlord one is deductible.
    const rules = sortRules([
      rule({
        id: "landlord",
        categoryId: "cat_rental_insurance",
        field: "DESCRIPTION",
        pattern: "state insura # lans",
      }),
      rule({
        id: "motor",
        categoryId: "cat_motor",
        field: "DESCRIPTION",
        pattern: "state insura # mots",
      }),
      rule({
        id: "merchant_fallback",
        categoryId: "cat_motor",
        field: "MERCHANT",
        pattern: "iag",
      }),
    ]);

    const landlord = matchTransaction(
      transaction({
        description: "Iag New Zealand Limi State Insura 4155 Lans01",
        merchantName: "IAG",
      }),
      "PERSONAL",
      rules,
    );
    const motor = matchTransaction(
      transaction({
        description: "Iag New Zealand Limi State Insura 4155 Mots01",
        merchantName: "IAG",
      }),
      "PERSONAL",
      rules,
    );

    expect(landlord?.categoryId).toBe("cat_rental_insurance");
    expect(motor?.categoryId).toBe("cat_motor");
  });

  it("falls back to the merchant rule when no description rule matches", () => {
    const rules = sortRules([
      rule({
        id: "landlord",
        categoryId: "cat_rental_insurance",
        field: "DESCRIPTION",
        pattern: "state insura # lans",
      }),
      rule({
        id: "merchant_fallback",
        categoryId: "cat_motor",
        field: "MERCHANT",
        pattern: "iag",
      }),
    ]);

    const other = matchTransaction(
      transaction({
        description: "Iag New Zealand Limi Something Else",
        merchantName: "IAG",
      }),
      "PERSONAL",
      rules,
    );

    expect(other?.categoryId).toBe("cat_motor");
  });

  it("gives PayPal two meanings without any explicit account scoping", () => {
    // Book separation alone is enough: a BUSINESS rule can never see a
    // PERSONAL transaction, so the same merchant name resolves differently
    // in each book with no risk of crossover.
    const rules = sortRules([
      rule({
        id: "shopify",
        categoryId: "cat_biz_platform",
        categoryBook: "BUSINESS",
        field: "DESCRIPTION",
        pattern: "paypal *shopifycomm",
        direction: "OUT",
      }),
      rule({
        id: "retail",
        categoryId: "cat_personal_retail",
        categoryBook: "PERSONAL",
        field: "MERCHANT",
        pattern: "paypal",
      }),
    ]);

    const business = matchTransaction(
      transaction({
        accountId: BUSINESS_ACCOUNT,
        description: "PAYPAL *SHOPIFYCOMM 6312 4029357733 428448101538",
        merchantName: "PayPal",
      }),
      "BUSINESS",
      rules,
    );
    const personal = matchTransaction(
      transaction({
        description: "PAYPAL *SOMETHING 6312 4029357733 111222333444",
        merchantName: "PayPal",
      }),
      "PERSONAL",
      rules,
    );

    expect(business?.categoryId).toBe("cat_biz_platform");
    expect(personal?.categoryId).toBe("cat_personal_retail");
  });

  it("separates a refund from a spend using direction alone", () => {
    // Contact Energy is a home-office power cost going out and a refund
    // coming in. Same payee, same merchant, opposite treatment.
    const rules = sortRules([
      rule({
        id: "refund",
        categoryId: "cat_refunds",
        field: "DESCRIPTION",
        pattern: "contact energy",
        direction: "IN",
      }),
      rule({
        id: "power",
        categoryId: "cat_home_power",
        field: "MERCHANT",
        pattern: "contact energy",
        direction: "OUT",
      }),
    ]);

    expect(
      matchTransaction(
        transaction({
          description: "Contact Energy L",
          merchantName: "Contact Energy",
          amountCents: 25920,
        }),
        "PERSONAL",
        rules,
      )?.categoryId,
    ).toBe("cat_refunds");

    expect(
      matchTransaction(
        transaction({
          description: "Contact Energy Ltd Goodman T 1234 5678",
          merchantName: "Contact Energy",
          amountCents: -25920,
        }),
        "PERSONAL",
        rules,
      )?.categoryId,
    ).toBe("cat_home_power");
  });

  it("keeps home rent and home water apart despite the shared prefix", () => {
    const rules = sortRules([
      rule({
        id: "rent",
        categoryId: "cat_home_rent",
        field: "DESCRIPTION",
        pattern: "blue fern property tg goodman t#",
      }),
      rule({
        id: "water",
        categoryId: "cat_home_water",
        field: "DESCRIPTION",
        pattern: "blue fern property tg goodman water",
      }),
    ]);

    expect(
      matchTransaction(
        transaction({ description: "Blue Fern Property Tg Goodman T337001" }),
        "PERSONAL",
        rules,
      )?.categoryId,
    ).toBe("cat_home_rent");

    expect(
      matchTransaction(
        transaction({
          description: "Blue Fern Property Tg Goodman Water T337001",
        }),
        "PERSONAL",
        rules,
      )?.categoryId,
    ).toBe("cat_home_water");
  });
});

describe("matchTransaction — book safety", () => {
  it("never assigns a category from the other book", () => {
    const rules = sortRules([
      rule({
        id: "personal",
        categoryId: "cat_personal",
        categoryBook: "PERSONAL",
        field: "DESCRIPTION",
        pattern: "mitre",
      }),
    ]);

    const onBusinessAccount = matchTransaction(
      transaction({
        accountId: BUSINESS_ACCOUNT,
        description: "MITRE 10 HELENSVILLE 6312 HELENSVILLE 434667131230",
      }),
      "BUSINESS",
      rules,
    );

    expect(onBusinessAccount).toBeNull();
  });

  it("matches nothing when the account has no book assigned", () => {
    // Guessing PERSONAL here would file business spending in the wrong set
    // of books — the exact failure the nullable `book` column exists for.
    const rules = sortRules([
      rule({ id: "any", field: "DESCRIPTION", pattern: "mitre" }),
    ]);

    expect(
      matchTransaction(
        transaction({ description: "MITRE 10 HELENSVILLE" }),
        null,
        rules,
      ),
    ).toBeNull();
  });

  it("respects an explicit account scope", () => {
    const rules = sortRules([
      rule({
        id: "scoped",
        field: "DESCRIPTION",
        pattern: "monthly bank fee",
        accountId: "acct_other",
      }),
    ]);

    expect(
      matchTransaction(
        transaction({ description: "MONTHLY BANK FEE" }),
        "PERSONAL",
        rules,
      ),
    ).toBeNull();
  });
});

describe("matchTransaction — determinism", () => {
  it("resolves equally specific rules the same way regardless of input order", () => {
    const a = rule({
      id: "aaa",
      categoryId: "cat_a",
      field: "DESCRIPTION",
      pattern: "shared",
    });
    const b = rule({
      id: "bbb",
      categoryId: "cat_b",
      field: "DESCRIPTION",
      pattern: "shared",
    });

    const forwards = matchTransaction(
      transaction({ description: "shared text" }),
      "PERSONAL",
      sortRules([a, b]),
    );
    const backwards = matchTransaction(
      transaction({ description: "shared text" }),
      "PERSONAL",
      sortRules([b, a]),
    );

    expect(forwards?.categoryId).toBe(backwards?.categoryId);
    expect(forwards?.categoryId).toBe("cat_a");
  });

  it("lets an explicit priority override an otherwise equal rule", () => {
    const rules = sortRules([
      rule({
        id: "aaa",
        categoryId: "cat_general",
        field: "DESCRIPTION",
        pattern: "shared",
      }),
      rule({
        id: "zzz",
        categoryId: "cat_exception",
        field: "DESCRIPTION",
        pattern: "shared",
        priority: 10,
      }),
    ]);

    expect(
      matchTransaction(
        transaction({ description: "shared text" }),
        "PERSONAL",
        rules,
      )?.categoryId,
    ).toBe("cat_exception");
  });

  it("returns null when nothing matches", () => {
    expect(
      matchTransaction(
        transaction({ description: "something nobody wrote a rule for" }),
        "PERSONAL",
        sortRules([rule({ id: "a", field: "DESCRIPTION", pattern: "mitre" })]),
      ),
    ).toBeNull();
  });
});

describe("priority against a catch-all", () => {
  // The flatmate rules are the first use of `priority` in definitions.ts, and
  // the case they exist for is narrow: a loan repayment to a flatmate and a
  // share of the groceries are both DESCRIPTION + OUT with no account scope,
  // so they are IDENTICAL on specificity. Without priority the winner falls to
  // the id tie-break — stable, but arbitrary, and arbitrary here means $1,645
  // of lending filed as a shared household cost. Both still balance.
  const loan = rule({
    id: "loan",
    pattern: "brett thomas brett loan",
    direction: "OUT",
    priority: 50,
  });
  const catchAll = rule({
    id: "aaa_catch_all", // sorts FIRST on the id tie-break, so priority has to do the work
    pattern: "brett thomas",
    direction: "OUT",
    priority: 100,
  });

  const payment = transaction({
    description: "Brett Thomas Brett Loan",
    amountCents: -4000,
  });

  it("sends a loan to the loan category, not the catch-all", () => {
    const sorted = sortRules([catchAll, loan]);

    expect(matchTransaction(payment, "PERSONAL", sorted)?.categoryId).toBe(
      "cat_loan",
    );
  });

  it("is not relying on specificity, which cannot separate these two", () => {
    expect(ruleSpecificity(loan)).toBe(ruleSpecificity(catchAll));
  });

  it("still sends an ordinary payment to the catch-all", () => {
    const sorted = sortRules([catchAll, loan]);
    const pizza = transaction({
      description: "Brett Thomas Pizza",
      amountCents: -2700,
    });

    expect(matchTransaction(pizza, "PERSONAL", sorted)?.categoryId).toBe(
      "cat_aaa_catch_all",
    );
  });

   it("routes by direction instead of letting the OUT rules match incoming money", () => {
     const incoming = rule({
       id: "incoming",
       pattern: "thomas brett",
       direction: "IN",
     });
     const sorted = sortRules([catchAll, loan, incoming]);
     const contribution = transaction({
       description: "Thomas Brett",
       amountCents: 10000,
     });

     expect(matchTransaction(contribution, "PERSONAL", sorted)?.categoryId).toBe(
       "cat_incoming",
     );
     expect(
       matchTransaction(
         transaction({
           description: "Brett Thomas Brett Loan",
           amountCents: -4000,
         }),
         "PERSONAL",
         sorted,
       )?.categoryId,
     ).toBe("cat_loan");
   });
});


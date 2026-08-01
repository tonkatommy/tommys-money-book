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

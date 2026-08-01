import { describe, expect, it } from "vitest";

import { descriptionMatches, normaliseDescription } from "./normalise";

describe("normaliseDescription", () => {
  it("lower-cases and trims", () => {
    expect(normaliseDescription("  MONTHLY BANK FEE  ")).toBe(
      "monthly bank fee",
    );
  });

  it("strips the trailing card number ANZ appends to EFTPOS rows", () => {
    expect(
      normaliseDescription("Helensville Card number: 4835 **** **** 3908"),
    ).toBe("helensville");
  });

  it("collapses the same merchant seen on different cards to one key", () => {
    // Three real baseline rows, three different cards, one merchant. If these
    // didn't collapse, Gas Helensville would need three rules.
    const keys = [
      "Gas Helensvi Card number: 4835 **** **** 3908",
      "Gas Helensvi Card number: 4835 **** **** 4010",
      "Gas Helensvi Card number: 4835 **** **** 8906",
    ].map(normaliseDescription);

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("gas helensvi");
  });

  it("collapses runs of three or more digits to a single #", () => {
    expect(
      normaliseDescription("MITRE 10 HELENSVILLE 6312 HELENSVILLE 434667131230"),
    ).toBe("mitre 10 helensville # helensville #");
  });

  it("keeps runs of one or two digits, which are part of names", () => {
    // "Mitre 10" and the "-03" account suffix are identity, not noise.
    expect(normaliseDescription("Mitre 10")).toBe("mitre 10");
    expect(normaliseDescription("To: 06-0878-0335888-03 rent")).toBe(
      "to: 06-#-#-03 rent",
    );
  });

  it("collapses two references from the same payee to one key", () => {
    // The exact case that makes rules possible: same Shopify subscription,
    // different transaction reference each month.
    const a = normaliseDescription(
      "PAYPAL *SHOPIFYCOMM 6312 4029357733 428448101538",
    );
    const b = normaliseDescription(
      "PAYPAL *SHOPIFYCOMM 6312 4029357733 442343092000",
    );

    expect(a).toBe(b);
    expect(a).toBe("paypal *shopifycomm # # #");
  });

  it("collapses internal whitespace", () => {
    expect(normaliseDescription("Sovereign Account   Go Home  Loan")).toBe(
      "sovereign account go home loan",
    );
  });

  it("is idempotent — normalising twice changes nothing", () => {
    // Matters because rule patterns are stored already-normalised, and the
    // seeder normalises whatever it is given. Running it over an
    // already-normalised pattern must not corrupt it.
    const once = normaliseDescription(
      "IAG NEW ZEALAND LIMI STATE INSURA 12345 LANS678",
    );
    expect(normaliseDescription(once)).toBe(once);
  });

  it("keeps the suffix that distinguishes IAG's three policies", () => {
    // The single most important thing this function must not destroy: only
    // the landlord policy is a deductible rental expense.
    const motor = normaliseDescription(
      "Iag New Zealand Limi State Insura 4155 Mots01",
    );
    const landlord = normaliseDescription(
      "Iag New Zealand Limi State Insura 4155 Lans01",
    );

    expect(motor).not.toBe(landlord);
    expect(landlord).toContain("lans");
    expect(motor).toContain("mots");
  });
});

describe("descriptionMatches", () => {
  it("matches on substring, not equality", () => {
    expect(descriptionMatches("strata title admin # unit 3", "strata title")).toBe(
      true,
    );
  });

  it("matches the reversal variant of a payee via the shared middle", () => {
    // A rule anchored on the distinctive middle catches both the payment and
    // its reversal, which an exact-match rule would miss.
    const payment = normaliseDescription("Strata Title Admin 571709 Unit 3");
    const reversal = normaliseDescription(
      "Strata Title - (Reversal) Strata Title Admin 05/12/2025",
    );

    expect(descriptionMatches(payment, "strata title admin")).toBe(true);
    expect(descriptionMatches(reversal, "strata title admin")).toBe(true);
  });

  it("does not match an unrelated description", () => {
    expect(descriptionMatches("monthly bank fee", "strata title")).toBe(false);
  });
});

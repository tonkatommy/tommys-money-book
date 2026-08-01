import { describe, expect, it } from "vitest";

import { centsToDollars, dollarsToCents, formatNZD } from "./money";

describe("dollarsToCents", () => {
  it("converts whole and simple amounts", () => {
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(1)).toBe(100);
    expect(dollarsToCents(-200)).toBe(-20000);
    expect(dollarsToCents(4820.55)).toBe(482055);
  });

  it("handles the amounts that break naive float maths", () => {
    // Every one of these appears in the Akahu fixtures for exactly this reason.
    expect(dollarsToCents(0.1)).toBe(10);
    expect(dollarsToCents(0.2)).toBe(20);
    expect(dollarsToCents(-5.5)).toBe(-550);
    expect(dollarsToCents(12.35)).toBe(1235);
    expect(dollarsToCents(-0.07)).toBe(-7);
    expect(dollarsToCents(-1234.56)).toBe(-123456);
    expect(dollarsToCents(12750.4)).toBe(1275040);
  });

  it("rounds half away from zero, symmetrically", () => {
    // 1.005 * 100 is 100.49999999999999 as a double. A naive Math.round gives
    // 100; the toPrecision step recovers the intended 101. The negative case
    // must lose the same cent, not a different one — Math.round alone would
    // give -100 for one and 101 for the other.
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(-1.005)).toBe(-101);
    expect(dollarsToCents(2.675)).toBe(268);
    expect(dollarsToCents(-2.675)).toBe(-268);
  });

  it("never returns negative zero", () => {
    // -0 round-trips inconsistently through JSON and Postgres, and would make
    // an otherwise-equal comparison surprising.
    expect(Object.is(dollarsToCents(-0), 0)).toBe(true);
    expect(Object.is(dollarsToCents(-0.001), 0)).toBe(true);
  });

  it("throws rather than silently corrupting the ledger", () => {
    // A NaN quietly becoming 0 is a wrong balance that surfaces months later.
    expect(() => dollarsToCents(Number.NaN)).toThrow(TypeError);
    expect(() => dollarsToCents(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() =>
      dollarsToCents("12.50" as unknown as number),
    ).toThrow(TypeError);
  });

  it("stays exact for a long column of transactions", () => {
    // The actual reason integer cents exist. Summed as floats, this drifts.
    const dollarAmounts = Array.from({ length: 1000 }, () => 0.1);

    const floatSum = dollarAmounts.reduce((a, b) => a + b, 0);
    const centSum = dollarAmounts
      .map(dollarsToCents)
      .reduce((a, b) => a + b, 0);

    expect(floatSum).not.toBe(100); // 99.9999999999986
    expect(centSum).toBe(10000); // exactly $100.00
  });
});

describe("centsToDollars", () => {
  it("round-trips through dollarsToCents", () => {
    for (const dollars of [0, 1, -200, 4820.55, -5.5, 12.35, -0.07]) {
      expect(centsToDollars(dollarsToCents(dollars))).toBe(dollars);
    }
  });
});

describe("formatNZD", () => {
  it("formats cents as NZ currency", () => {
    // Asserting on the exact literal output, deliberately. Intl formatting is
    // locale-data-dependent and shifts between Node and ICU versions — it can
    // switch to a non-breaking space, or move the minus sign relative to the
    // currency symbol. Pinning the strings means such a change breaks a test
    // instead of quietly altering every figure the status page renders.
    expect(formatNZD(482055)).toBe("$4,820.55");
    expect(formatNZD(0)).toBe("$0.00");
    expect(formatNZD(-550)).toBe("-$5.50");
  });
});

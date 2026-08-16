import { describe, expect, it } from "vitest";
import { billBudgetCents, parseDollarsToCents } from "./mutate";

// The database-touching functions in mutate.ts need a live Postgres and are
// verified by hand against the dev server, as the Phase 3a spec §7 sets out.
// What is unit-testable is the parsing at the form boundary — the place a
// typo turns into a wrong budget.

describe("parseDollarsToCents", () => {
  it("parses whole dollars", () => {
    expect(parseDollarsToCents("720")).toBe(72_000);
  });

  it("parses dollars and cents", () => {
    expect(parseDollarsToCents("142.60")).toBe(14_260);
  });

  it("accepts what people actually type", () => {
    expect(parseDollarsToCents("$1,850")).toBe(185_000);
    expect(parseDollarsToCents("  96.40 ")).toBe(9_640);
  });

  it("rounds half away from zero rather than drifting", () => {
    // The same reasoning as dollarsToCents in lib/money.ts: 1.005 * 100 is
    // 100.49999999999999 in binary floating point.
    expect(parseDollarsToCents("1.005")).toBe(101);
  });

  it("accepts zero — a real answer, meaning 'budget nothing here'", () => {
    expect(parseDollarsToCents("0")).toBe(0);
  });

  it("rejects unparseable input rather than reading it as zero", () => {
    // Returning 0 would wipe the category's budget and look deliberate.
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("12.34.56")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents(undefined)).toBeNull();
  });

  it("rejects a negative budget", () => {
    expect(parseDollarsToCents("-50")).toBeNull();
  });
});

describe("billBudgetCents", () => {
  const stable = {
    amountCents: 142_60,
    typicalAmountCents: 141_00,
    estimated: false,
  };
  const varies = {
    amountCents: 210_35,
    typicalAmountCents: 178_00,
    estimated: true,
  };

  it("takes the latest amount for a bill that doesn't move", () => {
    // For a stable bill the most recent figure is literally next month's cost.
    expect(billBudgetCents(null, stable)).toBe(143_00);
  });

  it("takes the median for a bill that varies", () => {
    // Power and water: the latest figure could be the winter peak.
    expect(billBudgetCents(null, varies)).toBe(178_00);
  });

  it("keeps a budget that was already set by hand", () => {
    expect(billBudgetCents(200_00, stable)).toBe(200_00);
    expect(billBudgetCents(200_00, varies)).toBe(200_00);
  });

  it("falls back to the detected amount when the standing budget is zero", () => {
    // A zero row is "no budget here yet", not a decision to budget nothing —
    // and pinning a bill at zero reserves nothing in safe-to-spend while also
    // removing it from the pace, so it would vanish from the budget entirely.
    expect(billBudgetCents(0, stable)).toBe(143_00);
  });

  it("always lands on a whole dollar", () => {
    expect(billBudgetCents(null, { ...stable, amountCents: 99_49 })).toBe(99_00);
    expect(billBudgetCents(99_49, stable)).toBe(99_00);
  });
});

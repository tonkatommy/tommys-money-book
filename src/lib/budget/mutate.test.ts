import { describe, expect, it } from "vitest";
import { parseDollarsToCents } from "./mutate";

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

import { describe, expect, it } from "vitest";
import { parseAmountToCents, signedAmountCents } from "./mutate";

// The database-touching functions here need a live Postgres and are verified by
// hand against the dev server, as the Phase 3a spec §7 sets out. What is
// unit-testable is the boundary where typed text becomes money — the place a
// slip turns into a wrong figure that looks deliberate ever after.

describe("parseAmountToCents", () => {
  it("parses what people actually type", () => {
    expect(parseAmountToCents("40")).toBe(4_000);
    expect(parseAmountToCents("40.50")).toBe(4_050);
    expect(parseAmountToCents("$1,240.99")).toBe(124_099);
    expect(parseAmountToCents("  12.30 ")).toBe(1_230);
  });

  it("rounds half away from zero rather than drifting", () => {
    // 1.005 * 100 is 100.49999999999999 in binary floating point, which is why
    // this goes through lib/money.ts rather than multiplying inline.
    expect(parseAmountToCents("1.005")).toBe(101);
  });

  it("rejects unparseable input rather than reading it as zero", () => {
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("12.34.56")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents(undefined)).toBeNull();
  });

  it("rejects a negative amount — direction is the radio's job", () => {
    expect(parseAmountToCents("-50")).toBeNull();
  });
});

describe("signedAmountCents", () => {
  it("stores money out as negative", () => {
    expect(signedAmountCents(4_000, "out")).toBe(-4_000);
  });

  it("leaves money in positive", () => {
    expect(signedAmountCents(4_000, "in")).toBe(4_000);
  });

  it("keeps zero unsigned", () => {
    // -0 is a genuinely surprising thing to find in a database column.
    expect(Object.is(signedAmountCents(0, "out"), 0)).toBe(true);
  });
});

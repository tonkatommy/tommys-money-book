// `saveTaxYearAdjustment` needs a live Postgres and is verified by hand
// against the dev server, as the Phase 3a spec §7 sets out. What's
// unit-testable is `parseOptionalDollars` — the form boundary where a typo
// could clear an existing adjustment or silently pass through as "not
// entered" rather than failing the submit.

import { describe, expect, it } from "vitest";
import { parseOptionalDollars } from "./mutate";

describe("parseOptionalDollars", () => {
  it("treats blank as null — 'not entered', not zero", () => {
    expect(parseOptionalDollars("")).toEqual({ ok: true, cents: null });
    expect(parseOptionalDollars("   ")).toEqual({ ok: true, cents: null });
    expect(parseOptionalDollars(null)).toEqual({ ok: true, cents: null });
    expect(parseOptionalDollars(undefined)).toEqual({ ok: true, cents: null });
  });

  it("parses a real amount to cents", () => {
    expect(parseOptionalDollars("1800")).toEqual({ ok: true, cents: 180_000 });
    expect(parseOptionalDollars("1,800.50")).toEqual({ ok: true, cents: 180_050 });
  });

  it("accepts an explicit zero as entered, distinct from blank", () => {
    // A confirmed $0 must not come back as { cents: null } — that's the
    // exact distinction managementFeeEntered (reports/ir3.ts) depends on.
    const result = parseOptionalDollars("0");
    expect(result).toEqual({ ok: true, cents: 0 });
    expect(result).not.toEqual({ ok: true, cents: null });
  });

  it("rejects unparseable input rather than silently treating it as blank", () => {
    // If this fell through to { cents: null }, a typo would be
    // indistinguishable from "not entered" and would save silently instead
    // of failing the submit.
    expect(parseOptionalDollars("abc")).toEqual({ ok: false });
    expect(parseOptionalDollars("12.34.56")).toEqual({ ok: false });
  });

  it("rejects a negative amount", () => {
    expect(parseOptionalDollars("-50")).toEqual({ ok: false });
  });
});

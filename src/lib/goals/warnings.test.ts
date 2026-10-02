// The goal warnings exist so a goal never shows a confident figure over a
// balance that can't be trusted. The cases guarded: an undated balance read
// as current, an instant's date shown in UTC rather than NZ, and an account
// that left the personal book making its goal vanish rather than say so.

import { describe, expect, it } from "vitest";
import { goalWarnings, type GoalAccountState } from "./warnings";

const NOW = new Date("2026-10-02T00:00:00Z"); // 1pm NZ, 02/10/2026

function account(over: Partial<GoalAccountState> = {}): GoalAccountState {
  return {
    name: "ANZ Japan",
    book: "PERSONAL",
    status: "ACTIVE",
    balanceCents: 250_000,
    balanceAsAt: new Date("2026-10-01T18:00:00Z"),
    driftIsPersistent: false,
    ...over,
  };
}

describe("goalWarnings", () => {
  it("says nothing about a healthy account", () => {
    expect(goalWarnings(account(), NOW)).toEqual([]);
  });

  it("treats an undated balance as stale rather than current", () => {
    const warnings = goalWarnings(account({ balanceAsAt: null }), NOW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/didn't say when/);
    expect(warnings[0].hidesFigures).toBe(false);
  });

  it("dates a stale balance in NZ, not UTC", () => {
    // 11:00 UTC on 28/09 is 00:00 on 29/09 in Auckland (NZDT, UTC+13).
    const warnings = goalWarnings(
      account({ balanceAsAt: new Date("2026-09-28T11:00:00Z") }),
      NOW,
    );
    expect(warnings[0].message).toContain("29/09/2026");
  });

  it("hides the figures, but keeps the goal, when the account leaves the personal book", () => {
    for (const book of ["BUSINESS", null] as const) {
      const warnings = goalWarnings(account({ book }), NOW);
      expect(warnings[0].level).toBe("error");
      expect(warnings[0].hidesFigures).toBe(true);
    }
  });

  it("hides the figures when there is no balance at all, without a stale warning on top", () => {
    const warnings = goalWarnings(account({ balanceCents: null, balanceAsAt: null }), NOW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].hidesFigures).toBe(true);
  });

  it("flags an inactive connection and persistent drift beside the figures", () => {
    const warnings = goalWarnings(
      account({ status: "INACTIVE", driftIsPersistent: true }),
      NOW,
    );
    expect(warnings.map((warning) => warning.hidesFigures)).toEqual([false, false]);
    expect(warnings).toHaveLength(2);
  });
});

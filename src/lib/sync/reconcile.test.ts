import { describe, expect, it } from "vitest";

import {
  deriveOpeningBalanceCents,
  isDriftWorthWarningAbout,
  reconcileAccount,
  sumCents,
} from "./reconcile";

describe("deriveOpeningBalanceCents", () => {
  it("captures the balance that predates our earliest transaction", () => {
    // The account holds $4,820.55. The two years of history we just imported
    // account for $3,962.48 of movement. The remaining $858.07 existed before
    // Akahu's history starts — that's the opening balance.
    expect(deriveOpeningBalanceCents(482055, 396248)).toBe(85807);
  });

  it("can be negative for an overdrawn or credit account", () => {
    expect(deriveOpeningBalanceCents(-50000, 20000)).toBe(-70000);
  });
});

describe("reconcileAccount", () => {
  it("balances when we hold every transaction", () => {
    const result = reconcileAccount({
      akahuBalanceCents: 482055,
      openingBalanceCents: 85807,
      storedTotalCents: 396248,
    });

    expect(result).toEqual({
      computedBalanceCents: 482055,
      driftCents: 0,
      inBalance: true,
    });
  });

  it("reports drift equal to exactly the missing transaction", () => {
    // This is the whole point of the check. Drop one $85.40 grocery shop from
    // what we store and the drift is precisely -8540 — which makes the warning
    // actionable rather than just alarming.
    const missing = -8540;

    const result = reconcileAccount({
      akahuBalanceCents: 482055,
      openingBalanceCents: 85807,
      storedTotalCents: 396248 - missing,
    });

    expect(result!.driftCents).toBe(missing);
    expect(result!.inBalance).toBe(false);
  });

  it("returns null when there's nothing meaningful to compare", () => {
    // "Not checked" must stay distinguishable from "checked and fine" — a
    // fake zero here would show a green tick on an account we never verified.
    expect(
      reconcileAccount({
        akahuBalanceCents: null,
        openingBalanceCents: 85807,
        storedTotalCents: 396248,
      }),
    ).toBeNull();

    expect(
      reconcileAccount({
        akahuBalanceCents: 482055,
        openingBalanceCents: null,
        storedTotalCents: 396248,
      }),
    ).toBeNull();
  });

  it("treats a zero opening balance as a real value, not a missing one", () => {
    // A brand new account legitimately opens at zero. `?? null` on a 0 would
    // be a classic falsy bug here.
    const result = reconcileAccount({
      akahuBalanceCents: 10000,
      openingBalanceCents: 0,
      storedTotalCents: 10000,
    });

    expect(result).not.toBeNull();
    expect(result!.inBalance).toBe(true);
  });

  it("derives an opening balance that immediately reconciles", () => {
    // Baseline invariant: whatever we derive must make the very next
    // reconciliation come out at zero drift, by construction.
    const akahuBalanceCents = 1275040;
    const storedTotalCents = 1234239;

    const opening = deriveOpeningBalanceCents(
      akahuBalanceCents,
      storedTotalCents,
    );

    expect(
      reconcileAccount({ akahuBalanceCents, openingBalanceCents: opening, storedTotalCents })!
        .driftCents,
    ).toBe(0);
  });
});

describe("isDriftWorthWarningAbout", () => {
  it("stays quiet when balanced or unchecked", () => {
    expect(isDriftWorthWarningAbout(null)).toBe(false);
    expect(
      isDriftWorthWarningAbout({
        computedBalanceCents: 100,
        driftCents: 0,
        inBalance: true,
      }),
    ).toBe(false);
  });

  it("warns on any non-zero drift, in either direction", () => {
    for (const driftCents of [1, -1, -8540]) {
      expect(
        isDriftWorthWarningAbout({
          computedBalanceCents: 100,
          driftCents,
          inBalance: false,
        }),
      ).toBe(true);
    }
  });
});

describe("sumCents", () => {
  it("is exact over a long column, unlike float dollars", () => {
    const cents = Array.from({ length: 10_000 }, () => 10);
    expect(sumCents(cents)).toBe(100_000);
  });

  it("sums an empty account to zero", () => {
    expect(sumCents([])).toBe(0);
  });
});

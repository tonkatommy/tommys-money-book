import { describe, expect, it } from "vitest";

import {
  deriveOpeningBalanceCents,
  isDriftPersistent,
  isDriftWorthWarningAbout,
  reconcileAccount,
  resolveOpeningBalanceCents,
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
      pendingTotalCents: 0,
    });

    expect(result).toEqual({
      computedBalanceCents: 482055,
      settledBalanceCents: 482055,
      pendingTotalCents: 0,
      driftCents: 0,
      inBalance: true,
    });
  });

  it("balances when unsettled card authorisations are in the bank's balance", () => {
    // The bug this replaces. ANZ's reported `current` balance already reflects
    // pending card authorisations, but the transaction feed only carries
    // settled rows — so an actively used card account showed permanent drift
    // exactly equal to whatever was pending.
    //
    // Real numbers from ANZ Money Card, 01/08/2026: ten pending authorisations
    // totalling -$233.02, and drift of precisely -$233.02.
    const result = reconcileAccount({
      akahuBalanceCents: 2055,
      openingBalanceCents: 60922,
      storedTotalCents: -35565,
      pendingTotalCents: -23302,
    });

    expect(result?.driftCents).toBe(0);
    expect(result?.inBalance).toBe(true);
    // The settled figure is still reported, because "what has actually cleared"
    // is the number that reconciles against a bank statement.
    expect(result?.settledBalanceCents).toBe(25357);
    expect(result?.pendingTotalCents).toBe(-23302);
  });

  it("still catches a missing transaction while something is pending", () => {
    // The check has to keep its teeth. Pending explains part of the gap; a
    // genuinely missing row must still show up as the remainder.
    const missing = -8540;

    const result = reconcileAccount({
      akahuBalanceCents: 2055,
      openingBalanceCents: 60922,
      storedTotalCents: -35565 - missing,
      pendingTotalCents: -23302,
    });

    expect(result?.driftCents).toBe(missing);
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
      pendingTotalCents: 0,
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
        pendingTotalCents: 0,
      }),
    ).toBeNull();

    expect(
      reconcileAccount({
        akahuBalanceCents: 482055,
        openingBalanceCents: null,
        storedTotalCents: 396248,
        pendingTotalCents: 0,
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
      pendingTotalCents: 0,
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
      reconcileAccount({
        akahuBalanceCents,
        openingBalanceCents: opening,
        storedTotalCents,
        pendingTotalCents: 0,
      })!.driftCents,
    ).toBe(0);
  });
});

describe("resolveOpeningBalanceCents", () => {
  const ANZ_BALANCE = 482055; // $4,820.55
  const ALL_TRANSACTIONS = 396248; // sum of the 20 we'd hold
  const DAY_ZERO = new Date("2024-08-02T00:00:00.000Z");

  it("REGRESSION: derives nothing when we hold no transactions yet", () => {
    // The bug this function exists for. Akahu can report an account with a
    // balance but no transactions — its docs note they take a few seconds to
    // process after a new connection. Deriving then gave
    // `opening = the entire balance`, and every transaction that arrived
    // afterwards looked like drift, permanently, with no code path to reset
    // it. Measured -$3,962.48 of phantom drift on a healthy account.
    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: null,
        akahuBalanceCents: ANZ_BALANCE,
        storedTotalCents: 0,
        pendingTotalCents: 0,
        earliestTransactionDate: null,
        previousHistoryStartDate: null,
      }),
    ).toBeNull();
  });

  it("REGRESSION: derives correctly once the transactions do arrive", () => {
    // The second half of the same scenario: having correctly held off, the
    // next run must produce the right answer rather than the poisoned one.
    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: null,
        akahuBalanceCents: ANZ_BALANCE,
        storedTotalCents: ALL_TRANSACTIONS,
        pendingTotalCents: 0,
        earliestTransactionDate: DAY_ZERO,
        previousHistoryStartDate: null,
      }),
    ).toBe(85807); // $858.07 of genuinely pre-history balance
  });

  it("keeps the stored value on an ordinary run", () => {
    // Re-deriving every run would make drift cancel itself out and the
    // reconciliation would always pass — worse than not having the check.
    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: 85807,
        akahuBalanceCents: ANZ_BALANCE,
        storedTotalCents: ALL_TRANSACTIONS,
        pendingTotalCents: 0,
        earliestTransactionDate: DAY_ZERO,
        previousHistoryStartDate: DAY_ZERO,
      }),
    ).toBe(85807);
  });

  it("keeps the stored value even when drift is present", () => {
    // The critical property: a missing recent transaction must stay visible
    // as drift, not be silently absorbed into a new opening balance.
    const withOneMissing = ALL_TRANSACTIONS - 8540;

    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: 85807,
        akahuBalanceCents: ANZ_BALANCE,
        storedTotalCents: withOneMissing,
        pendingTotalCents: 0,
        earliestTransactionDate: DAY_ZERO,
        previousHistoryStartDate: DAY_ZERO,
      }),
    ).toBe(85807);
  });

  it("re-derives when history now reaches further back", () => {
    // A first run that captured only part of the history measured from the
    // wrong starting point. Once older transactions arrive, the old figure is
    // definitionally stale and must be recomputed.
    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: 300000, // derived from a partial history
        akahuBalanceCents: ANZ_BALANCE,
        storedTotalCents: ALL_TRANSACTIONS,
        pendingTotalCents: 0,
        earliestTransactionDate: DAY_ZERO,
        previousHistoryStartDate: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toBe(85807);
  });

  it("does not re-derive when history start moves later", () => {
    // Shouldn't happen, but if Akahu ever returns a shallower window we must
    // not treat it as new information and recompute from less data.
    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: 85807,
        akahuBalanceCents: ANZ_BALANCE,
        storedTotalCents: ALL_TRANSACTIONS,
        pendingTotalCents: 0,
        earliestTransactionDate: new Date("2026-01-01T00:00:00.000Z"),
        previousHistoryStartDate: DAY_ZERO,
      }),
    ).toBe(85807);
  });

  it("treats a stored opening balance of 0 as real, not missing", () => {
    // A brand new account legitimately opens at zero. A falsy check here
    // would re-derive it on every single run.
    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: 0,
        akahuBalanceCents: 10000,
        storedTotalCents: 5000,
        pendingTotalCents: 0,
        earliestTransactionDate: DAY_ZERO,
        previousHistoryStartDate: DAY_ZERO,
      }),
    ).toBe(0);
  });

  it("holds off when Akahu reports no balance to measure against", () => {
    expect(
      resolveOpeningBalanceCents({
        storedOpeningBalanceCents: null,
        akahuBalanceCents: null,
        storedTotalCents: ALL_TRANSACTIONS,
        pendingTotalCents: 0,
        earliestTransactionDate: DAY_ZERO,
        previousHistoryStartDate: null,
      }),
    ).toBeNull();
  });

  it("the derived value always reconciles to zero drift", () => {
    // Baseline invariant, now routed through the resolver rather than the
    // raw subtraction.
    const opening = resolveOpeningBalanceCents({
      storedOpeningBalanceCents: null,
      akahuBalanceCents: ANZ_BALANCE,
      storedTotalCents: ALL_TRANSACTIONS,
      pendingTotalCents: 0,
      earliestTransactionDate: DAY_ZERO,
      previousHistoryStartDate: null,
    });

    expect(
      reconcileAccount({
        akahuBalanceCents: ANZ_BALANCE,
        openingBalanceCents: opening,
        storedTotalCents: ALL_TRANSACTIONS,
        pendingTotalCents: 0,
      })!.driftCents,
    ).toBe(0);
  });
});

describe("isDriftWorthWarningAbout", () => {
  it("stays quiet when balanced or unchecked", () => {
    expect(isDriftWorthWarningAbout(null)).toBe(false);
    expect(
      isDriftWorthWarningAbout({
        computedBalanceCents: 100,
        settledBalanceCents: 100,
        pendingTotalCents: 0,
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
          settledBalanceCents: 100,
          pendingTotalCents: 0,
          driftCents,
          inBalance: false,
        }),
      ).toBe(true);
    }
  });
});

describe("isDriftPersistent", () => {
  const at = (iso: string) => new Date(iso);

  it("REGRESSION: two runs 45 minutes apart are not persistent", () => {
    // The exact false alarm this function was written for, taken from real
    // data: ANZ Money Card, two manual baselines on the same morning both
    // seeing -$121.23. The old rule was "non-zero on the last two runs", which
    // only means "two days" if runs happen daily — and the manual CLI means
    // they don't. 45 minutes proves nothing about whether a payment settles.
    expect(
      isDriftPersistent([
        { driftCents: -12123, observedAt: at("2026-07-27T10:11:33Z") },
        { driftCents: -12123, observedAt: at("2026-07-27T09:27:07Z") },
        { driftCents: 0, observedAt: at("2026-07-26T01:38:08Z") },
      ]),
    ).toBe(false);
  });

  it("flags drift that outlives a full daily cycle", () => {
    expect(
      isDriftPersistent([
        { driftCents: -12123, observedAt: at("2026-07-28T07:00:00Z") },
        { driftCents: -12123, observedAt: at("2026-07-27T07:00:00Z") },
      ]),
    ).toBe(true);
  });

  it("stays quiet on a single observation, however large", () => {
    expect(
      isDriftPersistent([
        { driftCents: -999999, observedAt: at("2026-07-27T07:00:00Z") },
      ]),
    ).toBe(false);
  });

  it("stays quiet once the books balance again", () => {
    // Drift cleared on the latest run — whatever it was, it settled.
    expect(
      isDriftPersistent([
        { driftCents: 0, observedAt: at("2026-07-28T07:00:00Z") },
        { driftCents: -12123, observedAt: at("2026-07-27T07:00:00Z") },
        { driftCents: -12123, observedAt: at("2026-07-26T07:00:00Z") },
      ]),
    ).toBe(false);
  });

  it("resets the clock when drift cleared in between", () => {
    // Old drift settled, new drift appeared an hour ago. The stretch that
    // matters is the current one, not the total span of the history.
    expect(
      isDriftPersistent([
        { driftCents: -500, observedAt: at("2026-07-28T08:00:00Z") },
        { driftCents: -500, observedAt: at("2026-07-28T07:00:00Z") },
        { driftCents: 0, observedAt: at("2026-07-27T07:00:00Z") },
        { driftCents: -12123, observedAt: at("2026-07-20T07:00:00Z") },
      ]),
    ).toBe(false);
  });

  it("spans many runs of the same unbroken drift", () => {
    // Hourly runs across three days: lots of runs, and genuinely persistent.
    const history = Array.from({ length: 72 }, (_, hoursAgo) => ({
      driftCents: -12123,
      observedAt: new Date(Date.UTC(2026, 6, 28, 12 - hoursAgo)),
    }));

    expect(isDriftPersistent(history)).toBe(true);
  });

  it("ignores runs where drift could not be computed", () => {
    // A null is "not checked" (no opening balance yet, or the account failed),
    // not "balanced" — it must not break the stretch, nor extend it by itself.
    expect(
      isDriftPersistent([
        { driftCents: -12123, observedAt: at("2026-07-28T07:00:00Z") },
        { driftCents: null, observedAt: at("2026-07-27T19:00:00Z") },
        { driftCents: -12123, observedAt: at("2026-07-27T06:00:00Z") },
      ]),
    ).toBe(true);
  });

  it("copes with history in any order", () => {
    // Callers pass whatever order the database returned.
    expect(
      isDriftPersistent([
        { driftCents: -12123, observedAt: at("2026-07-27T07:00:00Z") },
        { driftCents: -12123, observedAt: at("2026-07-28T07:00:00Z") },
      ]),
    ).toBe(true);
  });

  it("handles an empty history", () => {
    expect(isDriftPersistent([])).toBe(false);
  });

  it("honours a custom threshold", () => {
    const history = [
      { driftCents: -12123, observedAt: at("2026-07-27T10:00:00Z") },
      { driftCents: -12123, observedAt: at("2026-07-27T08:00:00Z") },
    ];

    expect(isDriftPersistent(history, 1)).toBe(true);
    expect(isDriftPersistent(history, 4)).toBe(false);
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

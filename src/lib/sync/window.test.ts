import { describe, expect, it, vi, afterEach } from "vitest";

import {
  BASELINE_LOOKBACK_YEARS,
  DEFAULT_LOOKBACK_DAYS,
  baselineWindow,
  incrementalWindow,
  lookbackDaysFromEnv,
} from "./window";

const NOW = new Date("2026-07-25T06:00:00.000Z");

describe("baselineWindow", () => {
  it("asks for far more history than any bank will have", () => {
    // Omitting `start` entirely would make Akahu default to 30 days ago — a
    // baseline that looks successful and silently imports one month.
    const window = baselineWindow(NOW);

    expect(window.start).toBeDefined();
    expect(window.start!.getUTCFullYear()).toBe(
      NOW.getUTCFullYear() - BASELINE_LOOKBACK_YEARS,
    );
    expect(window.end).toEqual(NOW);
  });
});

describe("incrementalWindow", () => {
  it("looks BACK from the latest transaction, not forward from the last run", () => {
    // The heart of it. A transaction dated Monday can reach the bank feed on
    // Wednesday. Anchoring on run time means no future run ever asks for
    // Monday again, and it's lost silently.
    const latestHeld = new Date("2026-07-20T00:00:00.000Z");
    const window = incrementalWindow(latestHeld, { now: NOW });

    expect(window.start).toEqual(new Date("2026-07-13T00:00:00.000Z"));
    expect(window.end).toEqual(NOW);
  });

  it("respects a custom lookback", () => {
    const window = incrementalWindow(new Date("2026-07-20T00:00:00.000Z"), {
      now: NOW,
      lookbackDays: 30,
    });

    expect(window.start).toEqual(new Date("2026-06-20T00:00:00.000Z"));
  });

  it("falls back to a full baseline for an account never synced", () => {
    // A newly connected account should get its whole history, not the last
    // week — otherwise adding an account quietly gives it a stunted baseline.
    const window = incrementalWindow(null, { now: NOW });

    expect(window.start!.getUTCFullYear()).toBe(
      NOW.getUTCFullYear() - BASELINE_LOOKBACK_YEARS,
    );
  });

  it("never produces a start in the future", () => {
    // Guards against clock skew or a bad stored date turning into an invalid
    // or empty range that would silently sync nothing.
    const window = incrementalWindow(new Date("2027-01-01T00:00:00.000Z"), {
      now: NOW,
    });

    expect(window.start!.getTime()).toBeLessThan(NOW.getTime());
  });

  it("overlaps the previous window so nothing falls between runs", () => {
    // Consecutive daily runs must cover a contiguous range with overlap —
    // any gap is a permanently missing transaction.
    const day1 = incrementalWindow(new Date("2026-07-20T00:00:00.000Z"), {
      now: new Date("2026-07-21T06:00:00.000Z"),
    });
    const day2 = incrementalWindow(new Date("2026-07-21T00:00:00.000Z"), {
      now: new Date("2026-07-22T06:00:00.000Z"),
    });

    expect(day2.start!.getTime()).toBeLessThan(day1.end!.getTime());
  });
});

describe("lookbackDaysFromEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults when unset", () => {
    expect(lookbackDaysFromEnv({})).toBe(DEFAULT_LOOKBACK_DAYS);
  });

  it("reads a valid value", () => {
    expect(lookbackDaysFromEnv({ SYNC_LOOKBACK_DAYS: "14" })).toBe(14);
  });

  it("warns and defaults on nonsense rather than crashing the worker", () => {
    // A typo in .env shouldn't take the morning sync down.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(lookbackDaysFromEnv({ SYNC_LOOKBACK_DAYS: "soon" })).toBe(
      DEFAULT_LOOKBACK_DAYS,
    );
    expect(lookbackDaysFromEnv({ SYNC_LOOKBACK_DAYS: "-3" })).toBe(
      DEFAULT_LOOKBACK_DAYS,
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

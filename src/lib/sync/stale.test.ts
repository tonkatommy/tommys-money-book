// Whether the feed is overdue.
//
// Two things read this: the status page, to decide whether to show the red
// banner, and the worker, to decide whether to sync on startup. The cases that
// matter are the boundary (a normal overnight gap must not trigger a sync
// against Akahu's 1-hour rest limit) and the two null-ish states, both of
// which have been live in this app.

import { describe, expect, it } from "vitest";
import { STALE_AFTER_HOURS, hoursSince, isSyncStale } from "./stale";

/** `h` hours before the fixed `now` below. */
const now = new Date("2026-09-11T06:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("hoursSince", () => {
  it("counts forwards from the earlier instant", () => {
    expect(hoursSince(hoursAgo(36), now)).toBe(36);
  });

  it("goes negative for an instant in the future", () => {
    expect(hoursSince(hoursAgo(-2), now)).toBe(-2);
  });
});

describe("isSyncStale", () => {
  it("treats a normal overnight gap as current", () => {
    // The whole point of 36 rather than 24: the worker runs at 7am, so the gap
    // between two successful runs is ~24 hours and must never read as stale.
    expect(isSyncStale(hoursAgo(24), now)).toBe(false);
  });

  it("is not stale exactly at the threshold", () => {
    expect(isSyncStale(hoursAgo(STALE_AFTER_HOURS), now)).toBe(false);
  });

  it("is stale just past the threshold", () => {
    expect(isSyncStale(hoursAgo(STALE_AFTER_HOURS + 0.5), now)).toBe(true);
  });

  it("treats one missed morning as stale", () => {
    expect(isSyncStale(hoursAgo(48), now)).toBe(true);
  });

  it("treats the real 27-day outage as stale", () => {
    // 15/08/2026 to 11/09/2026, the gap this rule was written for: a worker up
    // and correctly scheduled the entire time, and one baseline run to show
    // for it.
    expect(isSyncStale(new Date("2026-08-15T10:46:00Z"), now)).toBe(true);
  });

  it("treats no successful sync on record as stale", () => {
    // First boot, and also "every run so far has failed". Both want a sync.
    expect(isSyncStale(null, now)).toBe(true);
  });

  it("treats a future timestamp as current, not as wildly overdue", () => {
    // A clock that jumped or a restored backup. Erring the other way would
    // sync on every boot, against a bank API with a 1-hour rest limit.
    expect(isSyncStale(hoursAgo(-72), now)).toBe(false);
  });

  it("honours a caller-supplied threshold", () => {
    expect(isSyncStale(hoursAgo(2), now, 1)).toBe(true);
    expect(isSyncStale(hoursAgo(2), now, 6)).toBe(false);
  });
});

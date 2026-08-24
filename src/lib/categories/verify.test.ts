// The GST monitor's window.
//
// The sum itself needs a database and is verified by hand; the window does
// not, and the window is where the figure was actually wrong. Registration is
// triggered by turnover in the PAST 12 months, so a window that is not 12
// months, or that changes shape depending on the time of day it is asked,
// produces a number nobody can recompute later.

import { afterEach, describe, expect, it, vi } from "vitest";
import { utcDate } from "@/lib/budget/period";
import { gstWindow } from "./verify";

describe("gstWindow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends on the NZ calendar date, not the UTC one", () => {
    // 23 Aug 2026 21:00 UTC is 24 Aug 09:00 in Auckland. The old code compared
    // `@db.Date` values at UTC midnight against this raw instant, so a sale
    // banked on the morning of the 24th NZ time fell outside its own window
    // until UTC caught up around midday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T21:00:00Z"));

    expect(gstWindow().to).toEqual(utcDate(2026, 7, 24));
  });

  it("does not move with the clock inside one NZ day", () => {
    // The whole point: 09:00 and 21:00 on the same NZ day are the same window.
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-08-23T21:00:00Z")); // 24 Aug 09:00 NZ
    const morning = gstWindow();

    vi.setSystemTime(new Date("2026-08-24T09:00:00Z")); // 24 Aug 21:00 NZ
    const evening = gstWindow();

    expect(morning).toEqual(evening);
  });

  it("spans a full 12 months, both ends inclusive", () => {
    const window = gstWindow(utcDate(2026, 7, 24));

    // The day after the same date a year earlier, through today. 25/08/2025
    // to 24/08/2026 is 365 days with neither end double-counted against the
    // window that ended yesterday.
    expect(window.from).toEqual(utcDate(2025, 7, 25));
    expect(window.to).toEqual(utcDate(2026, 7, 24));
    expect(
      (window.to.getTime() - window.from.getTime()) / 86_400_000 + 1,
    ).toBe(365);
  });

  it("clamps 29 February rather than rolling into March", () => {
    // 2028 is a leap year, 2027 is not. `setFullYear` on 29/02/2028 gives
    // 01/03/2027 and quietly loses a day off the far end of the window.
    const window = gstWindow(utcDate(2028, 1, 29));

    expect(window.from).toEqual(utcDate(2027, 2, 1));
    expect(window.to).toEqual(utcDate(2028, 1, 29));
    expect(
      (window.to.getTime() - window.from.getTime()) / 86_400_000 + 1,
    ).toBe(366);
  });

  it("keeps a leap day inside the window it belongs to", () => {
    // Asked on 01/03/2028, the window must still contain 29/02/2028.
    const window = gstWindow(utcDate(2028, 2, 1));

    expect(window.from.getTime()).toBeLessThan(utcDate(2028, 1, 29).getTime());
    expect(window.to.getTime()).toBeGreaterThan(utcDate(2028, 1, 29).getTime());
  });
});

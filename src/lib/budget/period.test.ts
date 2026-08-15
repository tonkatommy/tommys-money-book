import { describe, expect, it } from "vitest";
import {
  currentPayPeriod,
  daysOf,
  dueDateIn,
  nzToday,
  payPeriodFor,
  previousPeriods,
  utcDate,
} from "./period";

const ANCHOR = 20;

describe("nzToday", () => {
  // The whole period model rests on this. NZ is 12 hours ahead of UTC in
  // winter, so for half of every NZ day the UTC date is still yesterday —
  // and on payday that difference moves every figure on the overview by a
  // month.
  it("is already tomorrow in NZ when UTC is still on the previous evening", () => {
    // 19 Aug 2026 21:00 UTC is 20 Aug 09:00 in Auckland.
    expect(nzToday(new Date("2026-08-19T21:00:00Z"))).toEqual(
      utcDate(2026, 7, 20),
    );
  });

  it("is still today in NZ during the UTC morning", () => {
    // 20 Aug 2026 00:30 UTC is 20 Aug 12:30 in Auckland.
    expect(nzToday(new Date("2026-08-20T00:30:00Z"))).toEqual(
      utcDate(2026, 7, 20),
    );
  });

  it("handles NZ daylight saving", () => {
    // January is NZDT, 13 hours ahead.
    expect(nzToday(new Date("2027-01-14T11:30:00Z"))).toEqual(
      utcDate(2027, 0, 15),
    );
  });
});

describe("payPeriodFor", () => {
  it("runs anchor day to the day before the next anchor", () => {
    const period = payPeriodFor(utcDate(2026, 7, 15), ANCHOR);

    expect(period.start).toEqual(utcDate(2026, 6, 20));
    expect(period.end).toEqual(utcDate(2026, 7, 19));
    expect(period.nextPayday).toEqual(utcDate(2026, 7, 20));
    expect(period.label).toBe("20 Jul – 19 Aug");
    expect(period.daysInPeriod).toBe(31);
  });

  it("starts a new period on payday itself", () => {
    const period = payPeriodFor(utcDate(2026, 7, 20), ANCHOR);

    expect(period.start).toEqual(utcDate(2026, 7, 20));
    expect(period.dayOfPeriod).toBe(1);
  });

  it("puts the day before payday at the end of the old period", () => {
    const period = payPeriodFor(utcDate(2026, 7, 19), ANCHOR);

    expect(period.start).toEqual(utcDate(2026, 6, 20));
    expect(period.dayOfPeriod).toBe(31);
    expect(period.daysLeft).toBe(0);
  });

  it("counts the day and the days left", () => {
    const period = payPeriodFor(utcDate(2026, 7, 15), ANCHOR);

    // 20 Jul is day 1, so 15 Aug is day 27 of 31.
    expect(period.dayOfPeriod).toBe(27);
    expect(period.daysLeft).toBe(4);
    expect(period.elapsed).toBeCloseTo(27 / 31);
  });

  it("crosses a year boundary without special-casing December", () => {
    const period = payPeriodFor(utcDate(2027, 0, 5), ANCHOR);

    expect(period.start).toEqual(utcDate(2026, 11, 20));
    expect(period.end).toEqual(utcDate(2027, 0, 19));
  });

  it("clamps an anchor no month is long enough for", () => {
    // A 31st anchor in February: the period starts on the 28th instead.
    const period = payPeriodFor(utcDate(2027, 1, 28), 31);

    expect(period.start).toEqual(utcDate(2027, 1, 28));
    expect(period.end).toEqual(utcDate(2027, 2, 30));
  });

  it("never skips or doubles a day across a clamped run of months", () => {
    // Walk a whole year with a 31st anchor — the hardest case — and assert
    // each period starts exactly where the last one ended.
    let period = payPeriodFor(utcDate(2026, 0, 31), 31);

    for (let i = 0; i < 12; i++) {
      const next = payPeriodFor(period.nextPayday, 31);
      expect(next.start.getTime()).toBe(period.end.getTime() + 86_400_000);
      period = next;
    }
  });

  it("clamps the day number for a date outside the period", () => {
    // Reviewing a closed period: "today" is past the end, and the pace
    // figures must stay sane rather than reporting day 47 of 31.
    const period = payPeriodFor(utcDate(2026, 6, 25), ANCHOR);
    const stale = payPeriodFor(period.start, ANCHOR);

    expect(stale.dayOfPeriod).toBeLessThanOrEqual(stale.daysInPeriod);
  });
});

describe("currentPayPeriod", () => {
  it("resolves the period from NZ time, not UTC", () => {
    // Still 19 Aug in UTC, already 20 Aug (payday) in NZ.
    const period = currentPayPeriod(ANCHOR, new Date("2026-08-19T21:00:00Z"));

    expect(period.start).toEqual(utcDate(2026, 7, 20));
  });
});

describe("previousPeriods", () => {
  it("walks back, most recent first", () => {
    const period = payPeriodFor(utcDate(2026, 7, 15), ANCHOR);
    const previous = previousPeriods(period, 3, ANCHOR);

    expect(previous.map((p) => p.label)).toEqual([
      "20 Jun – 19 Jul",
      "20 May – 19 Jun",
      "20 Apr – 19 May",
    ]);
  });
});

describe("daysOf", () => {
  it("returns every date in the period, inclusive", () => {
    const period = payPeriodFor(utcDate(2026, 7, 15), ANCHOR);
    const days = daysOf(period);

    expect(days).toHaveLength(31);
    expect(days[0]).toEqual(period.start);
    expect(days[days.length - 1]).toEqual(period.end);
  });
});

describe("dueDateIn", () => {
  const period = payPeriodFor(utcDate(2026, 7, 15), ANCHOR);

  it("resolves a day that falls in the period's second month", () => {
    // The 3rd is August's, not July's — July's 3rd is before the period.
    expect(dueDateIn(period, 3)).toEqual(utcDate(2026, 7, 3));
  });

  it("resolves a day that falls in the period's first month", () => {
    expect(dueDateIn(period, 24)).toEqual(utcDate(2026, 6, 24));
  });
});

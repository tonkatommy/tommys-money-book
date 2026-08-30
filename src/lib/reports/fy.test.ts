// The FY boundary, in both directions.
//
// One day either side of 01/04 puts a transaction in a different tax year, and
// that is the number someone eventually reads out to an accountant. Every case
// here is a date that has been got wrong in a spreadsheet at some point.

import { afterEach, describe, expect, it, vi } from "vitest";
import { utcDate } from "@/lib/budget/period";
import {
  currentFY,
  fyBounds,
  fyFor,
  fyRangeEnd,
  fyRangeLabel,
  parseFY,
  selectableFYs,
} from "./fy";

describe("fyBounds", () => {
  it("runs 01/04 to 31/03 and is named for the later year", () => {
    const fy = fyBounds(2027);

    expect(fy.label).toBe("FY2027");
    expect(fy.start).toEqual(utcDate(2026, 3, 1));
    expect(fy.end).toEqual(utcDate(2027, 2, 31));
    expect(fy.range).toBe("01/04/2026 – 31/03/2027");
  });
});

describe("fyFor", () => {
  // The plan's worked examples, kept verbatim so this test fails if the rule
  // is ever "simplified" into something that disagrees with the document.
  it("puts 15/03/2027 in FY2027", () => {
    expect(fyFor(utcDate(2027, 2, 15)).year).toBe(2027);
  });

  it("puts 15/04/2027 in FY2028", () => {
    expect(fyFor(utcDate(2027, 3, 15)).year).toBe(2028);
  });

  it("splits the year across 31/03 and 01/04", () => {
    expect(fyFor(utcDate(2027, 2, 31)).year).toBe(2027);
    expect(fyFor(utcDate(2027, 3, 1)).year).toBe(2028);
  });

  it("puts the first and last day of an FY in that FY", () => {
    const fy = fyBounds(2027);

    expect(fyFor(fy.start).year).toBe(2027);
    expect(fyFor(fy.end).year).toBe(2027);
  });

  it("handles a December date, where the +9 months rule crosses a year", () => {
    expect(fyFor(utcDate(2026, 11, 31)).year).toBe(2027);
  });
});

describe("currentFY", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The reason this is not `new Date()`. 31/03 21:00 UTC is already 01/04 in
  // Auckland, so the raw clock would file Tommy's morning in the FY that
  // closed the night before — off by a whole tax year, on the one day of the
  // year it matters most.
  it("resolves the boundary in NZ, not UTC", () => {
    expect(currentFY(new Date("2027-03-31T21:00:00Z")).year).toBe(2028);
  });

  it("is still the closing FY during the UTC morning of 31/03", () => {
    // 31 Mar 2027 00:30 UTC is 31 Mar 13:30 in Auckland.
    expect(currentFY(new Date("2027-03-31T00:30:00Z")).year).toBe(2027);
  });

  it("defaults to the system clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T21:00:00Z")); // 24 Aug 09:00 NZ

    expect(currentFY().year).toBe(2027);
  });
});

describe("parseFY", () => {
  const now = new Date("2026-08-24T00:00:00Z"); // FY2027

  it("reads a year in range", () => {
    expect(parseFY("2026", now).year).toBe(2026);
  });

  it("falls back to the current FY when absent or unparseable", () => {
    expect(parseFY(undefined, now).year).toBe(2027);
    expect(parseFY("", now).year).toBe(2027);
    expect(parseFY("last year", now).year).toBe(2027);
    expect(parseFY("2026.5", now).year).toBe(2027);
  });

  // A hand-typed year outside the data would render a page of confident
  // zeroes, which reads exactly like a real answer.
  it("refuses a future FY and one older than the data", () => {
    expect(parseFY("2028", now).year).toBe(2027);
    expect(parseFY("1994", now).year).toBe(2027);
  });
});

describe("selectableFYs", () => {
  it("offers the current FY first and does not go past it", () => {
    const years = selectableFYs(new Date("2026-08-24T00:00:00Z")).map(
      (fy) => fy.year,
    );

    expect(years).toEqual([2027, 2026, 2025, 2024]);
  });
});

describe("fyRangeEnd", () => {
  const fy = fyBounds(2027);

  it("closes a running FY at today", () => {
    const today = utcDate(2026, 7, 24);

    expect(fyRangeEnd(fy, today)).toEqual(today);
    expect(fyRangeLabel(fy, today)).toBe("01/04/2026 – 24/08/2026 (to date)");
  });

  it("closes a finished FY at 31/03", () => {
    const today = utcDate(2027, 7, 24);

    expect(fyRangeEnd(fy, today)).toEqual(fy.end);
    expect(fyRangeLabel(fy, today)).toBe("01/04/2026 – 31/03/2027");
  });

  it("treats the last day of the FY as complete", () => {
    expect(fyRangeEnd(fy, fy.end)).toEqual(fy.end);
    expect(fyRangeLabel(fy, fy.end)).toBe("01/04/2026 – 31/03/2027");
  });
});

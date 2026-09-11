// The New Zealand financial year, derived and never stored.
//
// This is the app's SECOND date regime and the reason §2 of the 3c spec spends
// most of its length on dates. `/budget` runs 20th to 19th because the
// question there is "how much until payday?". Nothing here can use that: the
// financial year runs 01/04 to 31/03 because IRD says so, and bending it to
// the pay anchor would produce a figure that is defensible nowhere.
//
// The consequence is that "August" on the budget screen and "August" on a
// report are not the same August and never will be. The mitigation is that
// every reports screen prints its literal date range next to its figure, so
// the two are never silently compared. That is why `FinancialYear` carries a
// `range` string rather than leaving each screen to format its own.
//
// Everything here is pure and unit-tested. "Now" resolves through `nzToday`,
// never a bare `new Date()` — an FY boundary read from the raw system clock is
// wrong for half of every NZ day, and on 01/04 it is wrong by a whole year.

import { nzDate, nzToday, utcDate } from "@/lib/budget/period";

/** A financial year, with everything a heading needs to describe it. */
export type FinancialYear = {
  /** The year the FY is named for: 01/04/2026–31/03/2027 is FY2027. */
  year: number;
  /** "FY2027" */
  label: string;
  /** 1 April, inclusive. UTC midnight, matching `Transaction.date`. */
  start: Date;
  /** 31 March, inclusive. */
  end: Date;
  /** "01/04/2026 – 31/03/2027" — printed next to every figure. */
  range: string;
};

/**
 * How far back the FY selector offers to go.
 *
 * The Akahu feed starts in 2024 and the archive behind it does not go much
 * further, so offering FY2015 would offer a screen of zeroes.
 */
export const FY_HISTORY = 3;

/** The FY bounds for a given FY number. */
export function fyBounds(year: number): FinancialYear {
  // FY2027 begins 01/04/2026 and ends 31/03/2027. March is month 2.
  const start = utcDate(year - 1, 3, 1);
  const end = utcDate(year, 2, 31);

  return {
    year,
    label: `FY${year}`,
    start,
    end,
    range: `${nzDate(start)} – ${nzDate(end)}`,
  };
}

/**
 * The financial year a stored date falls in.
 *
 * `date` is expected to be a UTC-midnight calendar date — a transaction's
 * stored date, or `nzToday()` for "now".
 *
 * The plan states the rule as "the year of `date + 9 months`", and it is
 * written that way rather than as a month comparison so it reads the same as
 * the plan does: 15/03/2027 + 9 months is December 2027, so FY2027;
 * 15/04/2027 + 9 months is January 2028, so FY2028.
 */
export function fyFor(date: Date): FinancialYear {
  return fyBounds(
    utcDate(date.getUTCFullYear(), date.getUTCMonth() + 9, 1).getUTCFullYear(),
  );
}

/** The financial year we are standing in, in NZ time. */
export function currentFY(now: Date = new Date()): FinancialYear {
  return fyFor(nzToday(now));
}

/**
 * Parse `?fy=2027`, falling back to the current FY.
 *
 * Never throws and never returns a year the data cannot support: a hand-typed
 * `?fy=1994` would otherwise render a page of confident zeroes, which is the
 * failure this whole phase is built to avoid.
 */
export function parseFY(value?: string, now: Date = new Date()): FinancialYear {
  const current = currentFY(now);
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) return current;
  if (parsed > current.year || parsed < current.year - FY_HISTORY) return current;

  return fyBounds(parsed);
}

/** The years the selector offers, most recent first. */
export function selectableFYs(now: Date = new Date()): FinancialYear[] {
  const current = currentFY(now);
  return Array.from({ length: FY_HISTORY + 1 }, (_, i) =>
    fyBounds(current.year - i),
  );
}

/**
 * The last day of the FY that has actually happened yet.
 *
 * The current FY ends nine months from now, and a query to 31/03 would be
 * honest about its filter and dishonest about its heading: "FY2027" over a
 * figure that is really five months of it. So the range is closed at today
 * and the heading says so. A past FY is complete and closes at 31/03.
 */
export function fyRangeEnd(fy: FinancialYear, today: Date = nzToday()): Date {
  return today < fy.end ? today : fy.end;
}

/** "01/04/2026 – 24/08/2026 (to date)" for a live FY, the full range for a closed one. */
export function fyRangeLabel(fy: FinancialYear, today: Date = nzToday()): string {
  const end = fyRangeEnd(fy, today);
  if (end.getTime() === fy.end.getTime()) return fy.range;
  return `${nzDate(fy.start)} – ${nzDate(end)} (to date)`;
}

/**
 * `YYYY-MM-DD`, the form `parseDateParam` in the transactions layer expects.
 *
 * `toISOString` is safe here only because every date in this module is UTC
 * midnight by construction. Hand it a real instant and it will silently give
 * you the UTC day, which for an NZ evening is tomorrow.
 */
export function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The `from`/`to` pair for a link out of a reports screen.
 *
 * Reports run on the financial year and `/transactions` defaults to the
 * calendar month, so a link without these lands on a different window than the
 * count that produced it — a total for one range opening a list for another is
 * how a correct figure gets doubted.
 *
 * `rangeEnd` rather than `fy.end` because a live FY is closed at today by
 * `fyRangeEnd`: linking to 31/03 would query nine months of future.
 */
export function rangeQuery(fy: FinancialYear, rangeEnd: Date): string {
  return `from=${iso(fy.start)}&to=${iso(rangeEnd)}`;
}

// The pay period, and why it isn't a calendar month.
//
// Tommy is paid monthly on the 20th. A calendar-month budget cuts every pay
// cycle in half, which makes the only question the budget exists to answer —
// "how much can I spend before payday?" — unanswerable without mental
// arithmetic across two months. So a period runs anchor day to anchor day
// minus one: 20 July to 19 August.
//
// Two things here are easy to get wrong and expensive to get wrong.
//
// 1. TIME ZONE. `Transaction.date` is a bare `@db.Date`, which Postgres hands
//    back as a Date at UTC midnight. "Today", meanwhile, is a question about
//    where Tommy is standing — Pacific/Auckland, 12 or 13 hours ahead. Derive
//    the period from the raw system clock and for most of the NZ day the app
//    is still on yesterday's date; on the 20th that puts payday itself in the
//    wrong period, and every figure on the overview shifts by a month. So the
//    calendar date is resolved in NZ first, and only then rebuilt as a
//    UTC-midnight Date to compare against stored dates.
//
// 2. SHORT MONTHS. An anchor of 31 has no equivalent in February. The start
//    clamps to the last day of the month, so a 31st anchor gives 31 Jan → 27
//    Feb → 28 Feb, and no period is ever skipped or doubled.

/** A pay period, with everything the UI needs to describe it. */
export type PayPeriod = {
  /** First day, inclusive. UTC midnight, matching `Transaction.date`. */
  start: Date;
  /** Last day, inclusive. */
  end: Date;
  /** "20 Jul – 19 Aug" */
  label: string;
  daysInPeriod: number;
  /** 1-based day number within the period, clamped to the period's length. */
  dayOfPeriod: number;
  /** Whole days remaining after today. 0 on the last day. */
  daysLeft: number;
  /** The day the next period starts — payday. */
  nextPayday: Date;
  /** How far through the period we are, 0–1. Drives the pace marker. */
  elapsed: number;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 86_400_000;

/** Build a UTC-midnight Date, the same shape Postgres returns for `@db.Date`. */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Days in a given month. `month` is 0-based. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Today's calendar date in New Zealand, as a UTC-midnight Date.
 *
 * `en-CA` because it formats as YYYY-MM-DD, which parses unambiguously —
 * unlike en-NZ's DD/MM/YYYY, which `Date` would read as US month-first.
 */
export function nzToday(now: Date = new Date()): Date {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);

  return utcDate(year, month - 1, day);
}

/** The anchor day for a given month, clamped to months too short to have it. */
function anchorFor(year: number, month: number, anchorDay: number): Date {
  return utcDate(year, month, Math.min(anchorDay, daysInMonth(year, month)));
}

function formatDay(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/**
 * The pay period containing `date`.
 *
 * `date` is expected to be a UTC-midnight calendar date — pass `nzToday()`
 * for "now", or a transaction's stored date to find which period it fell in.
 */
export function payPeriodFor(date: Date, anchorDay: number): PayPeriod {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  const thisMonthAnchor = anchorFor(year, month, anchorDay);

  // Before this month's anchor, we're still inside the period that began last
  // month. `month - 1` of 0 gives December of the previous year; Date.UTC
  // normalises that, so no wrap-around special case is needed.
  const start =
    date.getTime() >= thisMonthAnchor.getTime()
      ? thisMonthAnchor
      : anchorFor(year, month - 1, anchorDay);

  const nextPayday = anchorFor(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    anchorDay,
  );
  const end = new Date(nextPayday.getTime() - DAY_MS);

  const daysInPeriod = Math.round((nextPayday.getTime() - start.getTime()) / DAY_MS);

  // Clamped so a date outside the period (a closed period being reviewed)
  // still yields sane pace figures rather than a day 47 of 31.
  const rawDay = Math.round((date.getTime() - start.getTime()) / DAY_MS) + 1;
  const dayOfPeriod = Math.min(Math.max(rawDay, 1), daysInPeriod);

  return {
    start,
    end,
    label: `${formatDay(start)} – ${formatDay(end)}`,
    daysInPeriod,
    dayOfPeriod,
    daysLeft: daysInPeriod - dayOfPeriod,
    nextPayday,
    elapsed: dayOfPeriod / daysInPeriod,
  };
}

/** The current pay period, in NZ time. */
export function currentPayPeriod(
  anchorDay: number,
  now: Date = new Date(),
): PayPeriod {
  return payPeriodFor(nzToday(now), anchorDay);
}

/** The period immediately before `period`. */
export function previousPeriod(period: PayPeriod, anchorDay: number): PayPeriod {
  return payPeriodFor(new Date(period.start.getTime() - DAY_MS), anchorDay);
}

/**
 * The `count` periods before `period`, most recent first.
 *
 * Used for the three-period averages behind the budget suggestions.
 */
export function previousPeriods(
  period: PayPeriod,
  count: number,
  anchorDay: number,
): PayPeriod[] {
  const periods: PayPeriod[] = [];
  let cursor = period;
  for (let i = 0; i < count; i++) {
    cursor = previousPeriod(cursor, anchorDay);
    periods.push(cursor);
  }
  return periods;
}

/** Every date in a period, for the day-by-day chart. */
export function daysOf(period: PayPeriod): Date[] {
  return Array.from({ length: period.daysInPeriod }, (_, i) =>
    new Date(period.start.getTime() + i * DAY_MS),
  );
}

/** "15 Aug" — for chart labels and bill due dates. */
export function shortDate(date: Date): string {
  return formatDay(date);
}

/** "15/08/2026" — NZ convention, for anything that reads as a date proper. */
export function nzDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

/**
 * The date a fixed bill falls due within a period.
 *
 * A bill on the 3rd belongs to the month *after* a period starting on the
 * 20th, so the day is resolved against whichever of the period's two calendar
 * months actually contains it.
 */
export function dueDateIn(period: PayPeriod, dueDay: number): Date {
  const candidate = utcDate(
    period.start.getUTCFullYear(),
    period.start.getUTCMonth(),
    Math.min(dueDay, daysInMonth(period.start.getUTCFullYear(), period.start.getUTCMonth())),
  );

  if (candidate.getTime() >= period.start.getTime()) return candidate;

  const year = period.end.getUTCFullYear();
  const month = period.end.getUTCMonth();
  return utcDate(year, month, Math.min(dueDay, daysInMonth(year, month)));
}

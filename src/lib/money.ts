// Money, and why it's an integer.
//
// A JavaScript number is an IEEE-754 double. Doubles are binary fractions, and
// 0.1 has no exact binary representation any more than 1/3 has an exact decimal
// one. So `0.1 + 0.2 === 0.30000000000000004`, and a column of a few thousand
// bank transactions summed as floats drifts away from the truth by cents.
//
// The fix is to never store dollars. We store cents as a plain integer, do all
// arithmetic in integers (which doubles represent exactly up to 2^53, roughly
// 90 trillion dollars), and convert back to dollars only when formatting for a
// human. This module is the single place that conversion happens.
//
// Akahu hands us float dollars (`-5.5`), so the boundary is here.

/**
 * Convert float dollars from an external source into integer cents.
 *
 * The `toPrecision(15)` step deserves an explanation. `1.005 * 100` evaluates
 * to `100.49999999999999` because of the binary representation above — a naive
 * `Math.round` would give 100 cents instead of 101. Rounding the product to 15
 * significant digits first snaps that back to `100.5`, discarding the
 * floating-point noise while keeping every digit that could matter for money
 * (a double only carries ~15-17 significant digits in the first place).
 *
 * The sign dance afterwards gives round-half-away-from-zero, so -$1.005 and
 * +$1.005 round by the same magnitude. `Math.round` on its own rounds half
 * *up* (toward +∞), which would treat debits and credits differently — a
 * subtle asymmetry that would show up as a one-cent bias in the books.
 */
export function dollarsToCents(dollars: number): number {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) {
    // Loud failure on purpose. A NaN silently becoming 0 is a corrupted ledger
    // that looks fine until a reconciliation months later says otherwise.
    throw new TypeError(`Cannot convert ${String(dollars)} to cents`);
  }

  const scaled = Number.parseFloat((dollars * 100).toPrecision(15));
  const rounded = Math.round(Math.abs(scaled));

  // `|| 0` normalises -0 to 0, so a zero-value transaction never stores the
  // negative zero that Postgres and JSON both round-trip inconsistently.
  return (scaled < 0 ? -rounded : rounded) || 0;
}

/** Integer cents back to a float dollar amount. Display and export only. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** Format integer cents as NZ currency, e.g. -20000 -> "-$200.00". */
export function formatNZD(cents: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(centsToDollars(cents));
}

/**
 * The same, without the cents: -20000 -> "-$200".
 *
 * For budget figures specifically. A budget is a round decision — "$720 for
 * groceries" — and rendering it as $720.00 next to an actual of $611.40
 * invites the reader to compare digits that carry no information. Actuals
 * keep their cents; targets don't have any.
 */
export function formatNZDWhole(cents: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(centsToDollars(cents));
}

// Turning a bank description into something you can write a rule against.
//
// Bank descriptions are the same payee wearing a different hat every time.
// The same trip to Mitre 10 arrives as:
//
//   MITRE 10 HELENSVILLE 6312 HELENSVILLE 434667131230
//   MITRE 10 HELENSVILLE 6312 HELENSVILLE 434667131412
//
// The trailing number is a per-transaction reference and the 6312 is a
// terminal id. Neither identifies the payee, but both make every row unique —
// which is why the raw baseline has 1,253 distinct descriptions for 2,642
// transactions and looks unautomatable.
//
// Strip the noise and those 1,253 collapse hard: the 1,786 transactions Akahu
// failed to enrich come down to 184 distinct keys, of which the top 50 cover
// 92% of them. That is the difference between "hand-categorise 1,786 rows"
// and "write 50 rules".
//
// This function is used by three things that must agree exactly: the
// discovery report that shows you the keys, the matcher that applies rules to
// them, and the review queue that groups what's left. If they disagreed, a
// key you saw in the report wouldn't be a key you could write a rule for.

/**
 * Normalise a bank description for grouping and rule matching.
 *
 * Deliberately lossy, in a specific direction: it removes things that vary
 * per transaction and keeps everything that identifies who was paid.
 */
export function normaliseDescription(raw: string): string {
  return (
    raw
      .toLowerCase()
      // ANZ appends the card used to every EFTPOS row:
      //   "Helensville Card number: 4835 **** **** 3908"
      // It's always at the end, it's the same handful of cards, and keeping
      // it would split one merchant into one key per card — Gas Helensville
      // appears under three different card numbers in the baseline alone.
      .replace(/\s*card number:.*$/, "")
      // Runs of three or more digits are references, terminal ids, invoice
      // numbers and claim numbers. Three is the threshold rather than two
      // because shorter runs are usually part of the name — "Mitre 10",
      // "360Net", the "02"/"03" account suffixes — and collapsing those
      // would merge payees that are genuinely different.
      .replace(/\d{3,}/g, "#")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Does a normalised description contain this (already normalised) pattern?
 *
 * Substring rather than equality on purpose. Descriptions carry a variable
 * tail even after normalisation — `strata title admin # unit 3` vs
 * `strata title - (reversal) strata title admin #/#` — so a rule anchored on
 * the distinctive middle survives variations an exact match would miss.
 */
export function descriptionMatches(
  normalisedDescription: string,
  pattern: string,
): boolean {
  return normalisedDescription.includes(pattern);
}

// Deciding which category a transaction belongs to.
//
// Pure functions with no database access, so the interesting cases — the ones
// where getting it wrong moves money between tax treatments — are cheap to
// test and can't drift from what the seed file says.
//
// The whole design rests on one idea: rules are ordered by how *specific*
// they are, and the first match wins. Specificity is computed, not declared,
// so adding a rule can't accidentally outrank a narrower one just because it
// was added later.

import type {
  Book,
  RuleDirection,
  RuleField,
} from "@/generated/prisma/client";
import { descriptionMatches, normaliseDescription } from "./normalise";

/** The fields of a transaction the matcher can see. */
export type MatchableTransaction = {
  accountId: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  akahuCategoryName: string | null;
};

/** A rule, flattened with the book of the category it points at. */
export type MatchableRule = {
  id: string;
  categoryId: string;
  categoryBook: Book;
  field: RuleField;
  pattern: string;
  accountId: string | null;
  direction: RuleDirection;
  priority: number;
};

// How specific each field is, in the order the real data justifies:
//
//   DESCRIPTION     the raw bank text. Says exactly which IAG policy, which
//                   PayPal charge, which of three Blue Fern bills.
//   MERCHANT        Akahu's guess at who was paid. Right about identity,
//                   silent about purpose.
//   AKAHU_CATEGORY  Akahu's guess at what kind of thing it was. The broadest
//                   useful signal, and the one most often nearly-right.
//
// Multiplied by 10 so scope adjustments can never promote a rule past a
// different field's tier — a scoped AKAHU_CATEGORY rule must still lose to
// an unscoped DESCRIPTION one.
const FIELD_RANK: Record<RuleField, number> = {
  DESCRIPTION: 0,
  MERCHANT: 1,
  AKAHU_CATEGORY: 2,
};

/**
 * Lower is more specific, and more specific wins.
 *
 * Within a field, a rule scoped to an account beats one scoped to a
 * direction, which beats one with no scope at all. Both scopes together beat
 * either alone.
 */
export function ruleSpecificity(rule: MatchableRule): number {
  return (
    FIELD_RANK[rule.field] * 10 +
    (rule.accountId ? 0 : 2) +
    (rule.direction === "ANY" ? 1 : 0)
  );
}

/**
 * Order rules once, match many times.
 *
 * The final tie-break on `id` looks arbitrary and is deliberate: without it
 * two equally specific, equally prioritised rules would resolve according to
 * whatever order Postgres happened to return, and the same transaction could
 * land in different categories on different runs. A stable wrong answer is
 * debuggable; an unstable one is not.
 */
export function sortRules(rules: readonly MatchableRule[]): MatchableRule[] {
  return [...rules].sort(
    (a, b) =>
      ruleSpecificity(a) - ruleSpecificity(b) ||
      a.priority - b.priority ||
      a.id.localeCompare(b.id),
  );
}

function directionAllows(
  direction: RuleDirection,
  amountCents: number,
): boolean {
  if (direction === "ANY") return true;
  if (direction === "IN") return amountCents > 0;
  // A zero-amount row matches neither IN nor OUT, which is the honest answer:
  // it is neither money in nor money out.
  return amountCents < 0;
}

function fieldMatches(
  rule: MatchableRule,
  transaction: MatchableTransaction,
  normalisedDescription: string,
): boolean {
  switch (rule.field) {
    case "AKAHU_CATEGORY":
      return transaction.akahuCategoryName?.toLowerCase() === rule.pattern;
    case "MERCHANT":
      return transaction.merchantName?.toLowerCase() === rule.pattern;
    case "DESCRIPTION":
      return descriptionMatches(normalisedDescription, rule.pattern);
  }
}

/**
 * Find the rule that categorises this transaction, or null.
 *
 * `accountBook` is the book of the transaction's account, and it is a hard
 * gate rather than a preference: a personal category can never be assigned to
 * a business transaction, whatever the rules say. That is the golden rule of
 * this app (plan §5), and a mis-scoped rule is much the likeliest way to
 * break it — so the check lives here, where every path goes through it,
 * rather than in each caller.
 *
 * An account with no book yet matches nothing at all. Guessing PERSONAL would
 * quietly file business spending in the wrong set of books, which is the one
 * error this schema exists to prevent.
 *
 * `rules` must already be sorted by `sortRules`.
 */
export function matchTransaction(
  transaction: MatchableTransaction,
  accountBook: Book | null,
  rules: readonly MatchableRule[],
): MatchableRule | null {
  if (accountBook === null) return null;

  // Normalised once per transaction rather than once per rule — with ~120
  // rules and thousands of transactions that difference is the whole runtime.
  const normalised = normaliseDescription(transaction.description);

  for (const rule of rules) {
    if (rule.categoryBook !== accountBook) continue;
    if (rule.accountId !== null && rule.accountId !== transaction.accountId) {
      continue;
    }
    if (!directionAllows(rule.direction, transaction.amountCents)) continue;
    if (fieldMatches(rule, transaction, normalised)) return rule;
  }

  return null;
}

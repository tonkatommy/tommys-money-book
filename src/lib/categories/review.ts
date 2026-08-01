// The review queue: what the rules couldn't decide.
//
// The naive version of this is "list the uncategorised transactions", which
// for the baseline means 1,786 lines and nobody ever does it. Grouping by the
// normalised description key turns that into ~184 lines, and the top 25 of
// those cover 83% of the rows — so the queue is a morning's work rather than
// a project.
//
// The grouping key is deliberately the same one the matcher uses. A key you
// see here is a key you can paste straight into a rule in definitions.ts, or
// into `categories:recat --match`. If the queue grouped differently from the
// matcher, every key you read here would need translating before you could
// act on it.

import type { Book, PrismaClient } from "@/generated/prisma/client";
import { normaliseDescription } from "./normalise";

export type ReviewGroup = {
  key: string;
  book: Book | null;
  /** MIXED means the same payee appears on both sides — usually a refund. */
  direction: "IN" | "OUT" | "MIXED";
  count: number;
  netCents: number;
  /** Account names this key appears on, so scope is obvious at a glance. */
  accounts: string[];
  /** One untouched description, because the raw text is what you recognise. */
  sample: string;
  firstDate: Date;
  lastDate: Date;
};

export type ReviewOptions = {
  book?: Book;
  /** Ignore keys with fewer than this many transactions. */
  minCount?: number;
};

/**
 * Uncategorised transactions, grouped by normalised description.
 *
 * Sorted by count rather than dollar value on purpose: the queue is a list of
 * *decisions*, and one decision on 166 rows is worth more of your attention
 * than one decision on a single $16,000 row. The dollar figure is right there
 * in the output for when it isn't.
 */
export async function reviewQueue(
  prisma: PrismaClient,
  options: ReviewOptions = {},
): Promise<ReviewGroup[]> {
  const { book, minCount = 1 } = options;

  const transactions = await prisma.transaction.findMany({
    where: {
      categoryId: null,
      ...(book ? { account: { book } } : {}),
    },
    select: {
      description: true,
      amountCents: true,
      date: true,
      account: { select: { name: true, book: true } },
    },
    orderBy: { date: "asc" },
  });

  const groups = new Map<string, ReviewGroup & { accountSet: Set<string> }>();

  for (const transaction of transactions) {
    const key = normaliseDescription(transaction.description);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        book: transaction.account.book,
        direction: transaction.amountCents > 0 ? "IN" : "OUT",
        count: 1,
        netCents: transaction.amountCents,
        accounts: [],
        accountSet: new Set([transaction.account.name]),
        sample: transaction.description,
        firstDate: transaction.date,
        lastDate: transaction.date,
      });
      continue;
    }

    existing.count += 1;
    existing.netCents += transaction.amountCents;
    existing.accountSet.add(transaction.account.name);
    existing.lastDate = transaction.date;

    const thisDirection = transaction.amountCents > 0 ? "IN" : "OUT";
    if (existing.direction !== thisDirection) existing.direction = "MIXED";

    // A key spanning both books is possible in principle (two banks using
    // the same payee text) and is worth surfacing rather than hiding, so
    // null it out rather than picking one.
    if (existing.book !== transaction.account.book) existing.book = null;
  }

  return [...groups.values()]
    .map(({ accountSet, ...group }) => ({
      ...group,
      accounts: [...accountSet].sort(),
    }))
    .filter((group) => group.count >= minCount)
    .sort((a, b) => b.count - a.count || Math.abs(b.netCents) - Math.abs(a.netCents));
}

export type ReviewSummary = {
  uncategorised: number;
  total: number;
  distinctKeys: number;
  /** How many keys it would take to clear 80%, 90% and 95% of the queue. */
  keysFor80: number;
  keysFor90: number;
  keysFor95: number;
};

/** Headline numbers for the queue — how big, and how much work to clear. */
export async function reviewSummary(
  prisma: PrismaClient,
  groups: readonly ReviewGroup[],
): Promise<ReviewSummary> {
  const total = await prisma.transaction.count();
  const uncategorised = groups.reduce((sum, group) => sum + group.count, 0);

  const keysToReach = (fraction: number): number => {
    const target = uncategorised * fraction;
    let running = 0;
    for (const [index, group] of groups.entries()) {
      running += group.count;
      if (running >= target) return index + 1;
    }
    return groups.length;
  };

  return {
    uncategorised,
    total,
    distinctKeys: groups.length,
    keysFor80: keysToReach(0.8),
    keysFor90: keysToReach(0.9),
    keysFor95: keysToReach(0.95),
  };
}

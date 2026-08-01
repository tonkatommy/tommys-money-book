// Running the rules over stored transactions.
//
// Two callers, one code path: `categories:apply` for the backlog and the
// daily sync for newly imported rows. Sharing the path is the point — if the
// backlog and the sync could categorise differently, the books would slowly
// diverge from themselves and nothing would say so.

import type { Book, PrismaClient } from "@/generated/prisma/client";
import {
  matchTransaction,
  sortRules,
  type MatchableRule,
} from "./match";

export type ApplyOptions = {
  /** "uncategorised" leaves existing assignments alone. */
  scope?: "uncategorised" | "all";
  /**
   * Include rows a human categorised. Off by default, and that default is
   * the whole reason `categorySource` exists: a hand correction is a
   * correction *of* the rules, so re-running the rules over it would restore
   * exactly the answer that was wrong — silently, and in a way that still
   * balances.
   */
  force?: boolean;
  /** Compute everything, write nothing. */
  dryRun?: boolean;
  /** Restrict to specific transaction ids — used by the sync path. */
  transactionIds?: readonly string[];
};

export type CategoryTally = {
  categoryId: string;
  name: string;
  book: Book;
  count: number;
  netCents: number;
};

export type ApplyResult = {
  considered: number;
  matched: number;
  /** Rows whose category actually changed (matched, but not already there). */
  changed: number;
  skippedManual: number;
  unmatched: number;
  tallies: CategoryTally[];
};

/** Load every rule, flattened with its category's book, ready to match. */
export async function loadMatchableRules(
  prisma: PrismaClient,
): Promise<MatchableRule[]> {
  const rules = await prisma.categoryRule.findMany({
    include: { category: { select: { book: true } } },
  });

  return sortRules(
    rules.map((rule) => ({
      id: rule.id,
      categoryId: rule.categoryId,
      categoryBook: rule.category.book,
      field: rule.field,
      pattern: rule.pattern,
      accountId: rule.accountId,
      direction: rule.direction,
      priority: rule.priority,
    })),
  );
}

// Read in pages rather than all at once. The baseline is only 2,642 rows, but
// this runs on every sync forever and the cost of getting it right now is one
// while loop.
const PAGE_SIZE = 1000;

export async function applyRules(
  prisma: PrismaClient,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const {
    scope = "uncategorised",
    force = false,
    dryRun = false,
    transactionIds,
  } = options;

  const rules = await loadMatchableRules(prisma);

  const categories = await prisma.category.findMany({
    select: { id: true, name: true, book: true },
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const result: ApplyResult = {
    considered: 0,
    matched: 0,
    changed: 0,
    skippedManual: 0,
    unmatched: 0,
    tallies: [],
  };

  // categoryId -> the transaction ids that should move there. Grouping means
  // one updateMany per category instead of one update per transaction —
  // roughly 50 statements rather than 2,642.
  const assignments = new Map<string, string[]>();
  const tallyByCategory = new Map<string, { count: number; netCents: number }>();

  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.transaction.findMany({
      where: {
        ...(transactionIds ? { id: { in: [...transactionIds] } } : {}),
        ...(scope === "uncategorised" ? { categoryId: null } : {}),
      },
      select: {
        id: true,
        accountId: true,
        amountCents: true,
        description: true,
        merchantName: true,
        akahuCategoryName: true,
        categoryId: true,
        categorySource: true,
        account: { select: { book: true } },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;

    for (const transaction of page) {
      result.considered += 1;

      if (!force && transaction.categorySource === "MANUAL") {
        result.skippedManual += 1;
        continue;
      }

      // A confirmed transfer leg is not a rule's business either — the pair
      // decided its category and the pair is the authority on it.
      if (!force && transaction.categorySource === "TRANSFER") {
        result.skippedManual += 1;
        continue;
      }

      const rule = matchTransaction(
        transaction,
        transaction.account.book,
        rules,
      );

      if (rule === null) {
        result.unmatched += 1;
        continue;
      }

      result.matched += 1;

      const tally = tallyByCategory.get(rule.categoryId) ?? {
        count: 0,
        netCents: 0,
      };
      tally.count += 1;
      tally.netCents += transaction.amountCents;
      tallyByCategory.set(rule.categoryId, tally);

      if (transaction.categoryId === rule.categoryId) continue;

      result.changed += 1;
      const ids = assignments.get(rule.categoryId) ?? [];
      ids.push(transaction.id);
      assignments.set(rule.categoryId, ids);
    }

    if (page.length < PAGE_SIZE) break;
  }

  result.tallies = [...tallyByCategory.entries()]
    .map(([categoryId, tally]) => {
      const category = categoryById.get(categoryId);
      return {
        categoryId,
        name: category?.name ?? "(unknown)",
        book: category?.book ?? "PERSONAL",
        count: tally.count,
        netCents: tally.netCents,
      };
    })
    .sort((a, b) => b.count - a.count);

  if (dryRun) return result;

  const categorisedAt = new Date();

  for (const [categoryId, ids] of assignments) {
    await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { categoryId, categorySource: "RULE", categorisedAt },
    });
  }

  return result;
}

export type RuleCoverage = {
  ruleId: string;
  categoryName: string;
  book: Book;
  field: string;
  pattern: string;
  matches: number;
};

/**
 * How many baseline transactions each rule actually wins.
 *
 * A rule that wins nothing is almost always a typo — a pattern written
 * against the raw description instead of the normalised one, or a merchant
 * name spelled differently from Akahu's. It is the cheapest possible check
 * and it catches the one class of mistake that otherwise stays invisible:
 * the rule is there, it looks right, and the transactions quietly pile up in
 * the review queue instead.
 *
 * Counts are *winning* matches, not candidate matches, so a rule that is
 * always beaten by a more specific one also shows as zero — which is equally
 * worth knowing.
 */
export async function ruleCoverage(
  prisma: PrismaClient,
): Promise<RuleCoverage[]> {
  const rules = await loadMatchableRules(prisma);

  const stored = await prisma.categoryRule.findMany({
    include: { category: { select: { name: true, book: true } } },
  });
  const metaById = new Map(stored.map((r) => [r.id, r]));

  const wins = new Map<string, number>();

  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.transaction.findMany({
      select: {
        id: true,
        accountId: true,
        amountCents: true,
        description: true,
        merchantName: true,
        akahuCategoryName: true,
        account: { select: { book: true } },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;

    for (const transaction of page) {
      const rule = matchTransaction(
        transaction,
        transaction.account.book,
        rules,
      );
      if (rule) wins.set(rule.id, (wins.get(rule.id) ?? 0) + 1);
    }

    if (page.length < PAGE_SIZE) break;
  }

  return stored
    .map((rule) => ({
      ruleId: rule.id,
      categoryName: metaById.get(rule.id)?.category.name ?? "(unknown)",
      book: rule.category.book,
      field: rule.field,
      pattern: rule.pattern,
      matches: wins.get(rule.id) ?? 0,
    }))
    .sort((a, b) => a.matches - b.matches || a.pattern.localeCompare(b.pattern));
}

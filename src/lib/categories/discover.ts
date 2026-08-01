// The discovery report, as a repeatable query rather than a one-off.
//
// The first run of this produced docs/phase-2-discovery.md and decided the
// whole shape of Phase 2. It stays in the codebase because the same question
// gets asked again every time the category list is reshaped: what does the
// money actually do, and what is there to match on? A report you can only
// run once is a report you stop trusting the moment anything changes.

import type { Book, PrismaClient } from "@/generated/prisma/client";
import { normaliseDescription } from "./normalise";

export type EnrichmentCoverage = {
  book: Book | null;
  transactions: number;
  withAkahuCategory: number;
  withMerchant: number;
  withNeither: number;
  categorised: number;
};

export type RankedGroup = {
  book: Book | null;
  label: string;
  detail: string | null;
  count: number;
  inCents: number;
  outCents: number;
};

export type KeyCoverage = {
  distinctKeys: number;
  transactions: number;
  /** Cumulative transactions covered by the top N keys. */
  top10: number;
  top25: number;
  top50: number;
  top100: number;
};

export type DiscoveryReport = {
  generatedAt: Date;
  earliest: Date | null;
  latest: Date | null;
  coverage: EnrichmentCoverage[];
  akahuCategories: RankedGroup[];
  merchants: RankedGroup[];
  unenrichedKeys: RankedGroup[];
  keyCoverage: KeyCoverage;
  akahuTypes: RankedGroup[];
};

type Row = {
  amountCents: number;
  date: Date;
  description: string;
  merchantName: string | null;
  akahuCategoryName: string | null;
  akahuCategoryGroup: string | null;
  akahuType: string | null;
  categoryId: string | null;
  account: { book: Book | null };
};

/**
 * Build the whole report from one pass over the transactions.
 *
 * Deliberately not a set of SQL aggregates: the interesting grouping is by
 * normalised description, which isn't a column and can't be. Doing it all in
 * one pass in TypeScript keeps the report and the matcher using literally the
 * same normalisation function, which is the property that makes a key you
 * read here usable as a rule without translation.
 */
export async function buildDiscoveryReport(
  prisma: PrismaClient,
): Promise<DiscoveryReport> {
  const rows: Row[] = await prisma.transaction.findMany({
    select: {
      amountCents: true,
      date: true,
      description: true,
      merchantName: true,
      akahuCategoryName: true,
      akahuCategoryGroup: true,
      akahuType: true,
      categoryId: true,
      account: { select: { book: true } },
    },
    orderBy: { date: "asc" },
  });

  return {
    generatedAt: new Date(),
    earliest: rows[0]?.date ?? null,
    latest: rows[rows.length - 1]?.date ?? null,
    coverage: buildCoverage(rows),
    akahuCategories: rank(
      rows.filter((row) => row.akahuCategoryName),
      (row) => row.akahuCategoryName!,
      (row) => row.akahuCategoryGroup,
    ),
    merchants: rank(
      rows.filter((row) => row.merchantName),
      (row) => row.merchantName!,
      (row) => row.akahuCategoryName,
    ),
    unenrichedKeys: rank(
      rows.filter((row) => !row.merchantName),
      (row) => keyFor(row),
      () => null,
    ),
    keyCoverage: buildKeyCoverage(rows.filter((row) => !row.merchantName)),
    akahuTypes: rank(
      rows,
      (row) => row.akahuType ?? "(none)",
      () => null,
    ),
  };
}

/**
 * The grouping key: normalised description, except that every ANZ internal
 * transfer collapses to one key.
 *
 * Without that special case the 808 transfer legs would contribute ~340
 * distinct keys and drown the report in noise that tier 1 pairing already
 * handles automatically. They aren't a categorisation problem.
 */
function keyFor(row: Row): string {
  if (row.akahuType === "TRANSFER" && /^(to|from):/i.test(row.description)) {
    return "(ANZ internal transfer)";
  }
  return normaliseDescription(row.description);
}

function buildCoverage(rows: readonly Row[]): EnrichmentCoverage[] {
  const books: (Book | null)[] = ["PERSONAL", "BUSINESS", null];

  return books.map((book) => {
    // null is the rollup row — every transaction, both books.
    const scoped = book === null ? rows : rows.filter((r) => r.account.book === book);

    return {
      book,
      transactions: scoped.length,
      withAkahuCategory: scoped.filter((r) => r.akahuCategoryName).length,
      withMerchant: scoped.filter((r) => r.merchantName).length,
      withNeither: scoped.filter((r) => !r.akahuCategoryName && !r.merchantName)
        .length,
      categorised: scoped.filter((r) => r.categoryId).length,
    };
  });
}

function rank(
  rows: readonly Row[],
  label: (row: Row) => string,
  detail: (row: Row) => string | null,
): RankedGroup[] {
  const groups = new Map<string, RankedGroup>();

  for (const row of rows) {
    const key = `${row.account.book}::${label(row)}`;
    const existing = groups.get(key) ?? {
      book: row.account.book,
      label: label(row),
      detail: detail(row),
      count: 0,
      inCents: 0,
      outCents: 0,
    };

    existing.count += 1;
    if (row.amountCents > 0) existing.inCents += row.amountCents;
    else existing.outCents += row.amountCents;

    groups.set(key, existing);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function buildKeyCoverage(rows: readonly Row[]): KeyCoverage {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const descending = [...counts.values()].sort((a, b) => b - a);
  const cumulative = (n: number): number =>
    descending.slice(0, n).reduce((sum, count) => sum + count, 0);

  return {
    distinctKeys: counts.size,
    transactions: rows.length,
    top10: cumulative(10),
    top25: cumulative(25),
    top50: cumulative(50),
    top100: cumulative(100),
  };
}

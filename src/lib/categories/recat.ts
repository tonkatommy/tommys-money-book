// Bulk re-categorisation.
//
// The first draft of a category list is wrong in places — that is not a risk
// to be managed, it is a certainty to be planned for. If fixing a wrong
// decision is expensive, the list never improves and you end up living with
// the first guess. So this exists from day one rather than being deferred to
// "when it's needed".
//
// Everything here is filter-then-move, and the filter is always previewed
// before it writes. `previewRecat` and `applyRecat` build their filter from
// exactly the same function, so what you saw is what moves — a preview that
// could diverge from the write it approves would be worse than no preview.

import type { Book, Prisma, PrismaClient } from "@/generated/prisma/client";
import { normaliseDescription } from "./normalise";

export type RecatFilter = {
  /** Everything currently in this category (name; book narrows it). */
  fromCategory?: string;
  /** Normalised description substring — the keys `categories:review` prints. */
  matchKey?: string;
  /** Only rows with no category at all. */
  uncategorisedOnly?: boolean;
  book?: Book;
  accountName?: string;
  direction?: "IN" | "OUT";
};

export type RecatPreview = {
  count: number;
  netCents: number;
  /** A handful of real rows, so you can see what you're about to move. */
  samples: { date: Date; description: string; amountCents: number; account: string }[];
};

/**
 * Turn a filter into a Prisma `where`.
 *
 * `matchKey` is the awkward one: the normalised key doesn't exist as a
 * column, so it can't be filtered in SQL. It's applied in memory afterwards
 * — see `selectMatching`. Everything else narrows in the database first, so
 * the in-memory pass only ever sees a small set.
 */
function baseWhere(filter: RecatFilter): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {};

  if (filter.uncategorisedOnly) where.categoryId = null;

  if (filter.fromCategory) {
    where.category = {
      name: filter.fromCategory,
      ...(filter.book ? { book: filter.book } : {}),
    };
  }

  if (filter.book || filter.accountName) {
    where.account = {
      ...(filter.book ? { book: filter.book } : {}),
      ...(filter.accountName ? { name: filter.accountName } : {}),
    };
  }

  if (filter.direction === "IN") where.amountCents = { gt: 0 };
  if (filter.direction === "OUT") where.amountCents = { lt: 0 };

  return where;
}

type SelectedRow = {
  id: string;
  date: Date;
  description: string;
  amountCents: number;
  account: { name: string };
};

async function selectMatching(
  prisma: PrismaClient,
  filter: RecatFilter,
): Promise<SelectedRow[]> {
  if (!hasAnyCriterion(filter)) {
    // An empty filter would match every transaction in the database. That is
    // never what anyone means, and "move all 2,642 rows" is not a mistake
    // worth allowing on real financial data.
    throw new Error(
      "Refusing to run with no filter — that would move every transaction. " +
        "Give at least one of --from, --match, --uncategorised, --account, " +
        "--book or --direction.",
    );
  }

  const rows = await prisma.transaction.findMany({
    where: baseWhere(filter),
    select: {
      id: true,
      date: true,
      description: true,
      amountCents: true,
      account: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });

  if (!filter.matchKey) return rows;

  const needle = normaliseDescription(filter.matchKey);
  return rows.filter((row) =>
    normaliseDescription(row.description).includes(needle),
  );
}

function hasAnyCriterion(filter: RecatFilter): boolean {
  return Boolean(
    filter.fromCategory ||
      filter.matchKey ||
      filter.uncategorisedOnly ||
      filter.book ||
      filter.accountName ||
      filter.direction,
  );
}

export async function previewRecat(
  prisma: PrismaClient,
  filter: RecatFilter,
): Promise<RecatPreview> {
  const rows = await selectMatching(prisma, filter);

  return {
    count: rows.length,
    netCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    samples: rows.slice(0, 8).map((row) => ({
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      account: row.account.name,
    })),
  };
}

export type RecatResult = { moved: number; category: string; book: Book };

/**
 * Move everything the filter selects into a category.
 *
 * Writes `categorySource = MANUAL`, which is the important side effect: from
 * here on the matcher leaves these rows alone, so the correction survives
 * every future rule change and every daily sync. That is what makes this a
 * decision rather than a suggestion.
 */
export async function applyRecat(
  prisma: PrismaClient,
  filter: RecatFilter,
  toCategoryName: string,
  toBook?: Book,
): Promise<RecatResult> {
  const candidates = await prisma.category.findMany({
    where: { name: toCategoryName, ...(toBook ? { book: toBook } : {}) },
  });

  if (candidates.length === 0) {
    throw new Error(
      `No category named "${toCategoryName}"` +
        (toBook ? ` in the ${toBook} book.` : ". Check `categories:seed`."),
    );
  }

  if (candidates.length > 1) {
    // "Bank Fees & Interest" and "Internal Transfer" exist in both books by
    // design. Guessing which one was meant could move business spending into
    // the personal book, so: refuse, and say how to disambiguate.
    throw new Error(
      `"${toCategoryName}" exists in both books. Add --to-book PERSONAL or ` +
        `--to-book BUSINESS.`,
    );
  }

  const target = candidates[0]!;
  const rows = await selectMatching(prisma, filter);

  // The golden rule again, enforced at the second place it could be broken.
  // The matcher guards the automatic path; this guards the manual one.
  const wrongBook = await prisma.transaction.findFirst({
    where: {
      id: { in: rows.map((row) => row.id) },
      account: { book: { not: target.book } },
    },
    select: { id: true, account: { select: { name: true, book: true } } },
  });

  if (wrongBook) {
    throw new Error(
      `Refusing: "${target.name}" is a ${target.book} category but the ` +
        `selection includes transactions on ${wrongBook.account.name} ` +
        `(${wrongBook.account.book ?? "unassigned"}). Narrow with --book.`,
    );
  }

  const { count } = await prisma.transaction.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: {
      categoryId: target.id,
      categorySource: "MANUAL",
      categorisedAt: new Date(),
    },
  });

  return { moved: count, category: target.name, book: target.book };
}

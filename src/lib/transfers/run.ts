// Database glue for transfer detection.
//
// The matching logic lives in detect.ts and is pure. This file loads legs,
// writes confirmed pairs, and is deliberately thin — the interesting
// decisions are all testable without a database.

import { randomUUID } from "node:crypto";

import type { Book, PrismaClient } from "@/generated/prisma/client";
import {
  pairTransferLegs,
  parseTransferLeg,
  suggestTransferPairs,
  type ConfirmedPair,
  type ResolvedLeg,
  type TransferSuggestion,
} from "./detect";

export type DetectResult = {
  tier1Pairs: ConfirmedPair[];
  /** Legs naming an account that isn't ours — correctly left alone. */
  tier1External: { id: string; description: string; amountCents: number }[];
  tier1Unmatched: { id: string; description: string; amountCents: number }[];
  written: number;
  suggestions: TransferSuggestion[];
};

/**
 * Tier 1: pair every ANZ internal transfer, and write the pairs.
 *
 * Legs that already carry a transferPairId are excluded from the start, so
 * re-running is free and can never re-pair something differently.
 */
export async function detectTransfers(
  prisma: PrismaClient,
  options: { dryRun?: boolean } = {},
): Promise<DetectResult> {
  const accounts = await prisma.account.findMany({
    select: {
      id: true,
      name: true,
      book: true,
      akahuName: true,
      formattedAccount: true,
    },
  });

  const accountIdByNumber = new Map(
    accounts
      .filter((account) => account.formattedAccount)
      .map((account) => [account.formattedAccount!, account.id]),
  );

  const candidates = await prisma.transaction.findMany({
    where: { transferPairId: null, akahuType: "TRANSFER" },
    select: {
      id: true,
      accountId: true,
      date: true,
      amountCents: true,
      description: true,
    },
  });

  const resolved: ResolvedLeg[] = [];

  for (const transaction of candidates) {
    const parsed = parseTransferLeg(transaction.description);
    if (!parsed) continue;

    resolved.push({
      ...transaction,
      parsed,
      counterpartyAccountId:
        accountIdByNumber.get(parsed.counterpartyNumber) ?? null,
    });
  }

  const { pairs, unmatchedOut, unmatchedIn } = pairTransferLegs(resolved);

  const external = unmatchedOut.filter(
    (leg) => leg.counterpartyAccountId === null,
  );
  const genuinelyUnmatched = [
    ...unmatchedOut.filter((leg) => leg.counterpartyAccountId !== null),
    ...unmatchedIn,
  ];

  let written = 0;

  if (!options.dryRun) {
    for (const pair of pairs) {
      await writePair(prisma, pair.outLegId, pair.inLegId);
      written += 1;
    }
  }

  return {
    tier1Pairs: pairs,
    tier1External: external.map(summarise),
    tier1Unmatched: genuinelyUnmatched.map(summarise),
    written,
    suggestions: await buildSuggestions(prisma, accounts),
  };
}

function summarise(leg: {
  id: string;
  description: string;
  amountCents: number;
}): { id: string; description: string; amountCents: number } {
  return {
    id: leg.id,
    description: leg.description,
    amountCents: leg.amountCents,
  };
}

/**
 * Tier 2 candidates: everything still unpaired, matched on date and amount.
 *
 * Deliberately excludes rows Akahu typed as TRANSFER — those are tier 1's
 * job, and anything tier 1 left unpaired was left unpaired for a reason.
 */
async function buildSuggestions(
  prisma: PrismaClient,
  accounts: readonly {
    id: string;
    name: string;
    book: Book | null;
    akahuName: string | null;
  }[],
): Promise<TransferSuggestion[]> {
  const unpaired = await prisma.transaction.findMany({
    where: { transferPairId: null, akahuType: { not: "TRANSFER" } },
    select: {
      id: true,
      accountId: true,
      date: true,
      amountCents: true,
      description: true,
    },
  });

  return suggestTransferPairs(
    unpaired.filter((row) => row.amountCents < 0),
    unpaired.filter((row) => row.amountCents > 0),
    accounts,
  );
}

/**
 * Link two legs and give them the right category.
 *
 * Same-book pairs become Internal Transfer and net to zero. Cross-book pairs
 * become owner contributions or drawings — they still link, so the movement
 * is traceable, but they must NOT net to zero inside one book: the business
 * genuinely received capital and the personal book genuinely parted with it.
 */
export async function writePair(
  prisma: PrismaClient,
  outLegId: string,
  inLegId: string,
): Promise<void> {
  const legs = await prisma.transaction.findMany({
    where: { id: { in: [outLegId, inLegId] } },
    select: {
      id: true,
      amountCents: true,
      transferPairId: true,
      account: { select: { book: true, name: true } },
    },
  });

  if (legs.length !== 2) {
    throw new Error(
      `Expected two legs for a pair, found ${legs.length}. ` +
        `Ids: ${outLegId}, ${inLegId}`,
    );
  }

  const already = legs.find((leg) => leg.transferPairId !== null);
  if (already) {
    throw new Error(
      `Transaction ${already.id} is already part of transfer pair ` +
        `${already.transferPairId}. Unlink it first.`,
    );
  }

  // The invariant, checked before writing rather than asserted afterwards.
  const total = legs.reduce((sum, leg) => sum + leg.amountCents, 0);
  if (total !== 0) {
    throw new Error(
      `Refusing to pair: the two legs sum to ${total} cents, not zero. ` +
        `A transfer that doesn't net to zero isn't a transfer.`,
    );
  }

  const outLeg = legs.find((leg) => leg.id === outLegId)!;
  const inLeg = legs.find((leg) => leg.id === inLegId)!;
  const crossBook =
    outLeg.account.book !== null &&
    inLeg.account.book !== null &&
    outLeg.account.book !== inLeg.account.book;

  const transferPairId = randomUUID();
  const categorisedAt = new Date();

  const assign = async (
    transactionId: string,
    book: Book | null,
    categoryName: string,
  ): Promise<void> => {
    const category = book
      ? await prisma.category.findUnique({
          where: { name_book: { name: categoryName, book } },
        })
      : null;

    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        transferPairId,
        ...(category
          ? {
              categoryId: category.id,
              categorySource: "TRANSFER",
              categorisedAt,
            }
          : {}),
      },
    });
  };

  if (crossBook) {
    // Direction decides the words: money leaving personal for business is a
    // contribution; the other way round is a drawing.
    const businessLeg = outLeg.account.book === "BUSINESS" ? outLeg : inLeg;
    const personalLeg = businessLeg === outLeg ? inLeg : outLeg;
    const businessPaidOut = businessLeg.amountCents < 0;

    await assign(
      businessLeg.id,
      businessLeg.account.book,
      businessPaidOut ? "Owner Drawings" : "Owner Contribution",
    );
    await assign(
      personalLeg.id,
      personalLeg.account.book,
      "Owner Contribution to Business",
    );
    return;
  }

  await assign(outLeg.id, outLeg.account.book, "Internal Transfer");
  await assign(inLeg.id, inLeg.account.book, "Internal Transfer");
}

export type PairIntegrityProblem = {
  transferPairId: string;
  legs: number;
  netCents: number;
};

/**
 * Every stored pair must have exactly two legs summing to zero.
 *
 * Cheap to run, and it is the assertion that makes "transfers never count as
 * income or expenses" a checkable property rather than a hope.
 */
export async function checkPairIntegrity(
  prisma: PrismaClient,
): Promise<PairIntegrityProblem[]> {
  const rows = await prisma.transaction.groupBy({
    by: ["transferPairId"],
    where: { transferPairId: { not: null } },
    _count: { _all: true },
    _sum: { amountCents: true },
  });

  return rows
    .filter((row) => row._count._all !== 2 || (row._sum.amountCents ?? 0) !== 0)
    .map((row) => ({
      transferPairId: row.transferPairId!,
      legs: row._count._all,
      netCents: row._sum.amountCents ?? 0,
    }));
}

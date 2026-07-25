// How far back does each bank's history actually reach?
//
// The implementation plan flags this as a risk (§8) and an open question (§9):
// the regulated system says banks provide up to two years, but what Akahu
// actually returns varies per bank. The answer decides two real things:
//
//   - where the app's records start, and what stays in the frozen Excel
//     archive forever;
//   - whether the first IR3 can be produced from the app alone, or needs the
//     spreadsheet alongside it (the FY starting 01/04/2026).
//
// So it's worth a dedicated, read-only report rather than a line buried in
// sync output.

import type { PrismaClient } from "@/generated/prisma/client";
import { createGateway, type AkahuGateway } from "@/lib/akahu";
import { baselineWindow } from "./window";

export type HistoryDepth = {
  accountName: string;
  connectionName: string | null;
  supportsTransactions: boolean;
  transactionCount: number;
  earliest: Date | null;
  latest: Date | null;
  /** Whole months between earliest and today. */
  monthsOfHistory: number | null;
  /** Does the history reach back to the start of FY2027 (01/04/2026)? */
  coversFy2027: boolean;
};

/**
 * Ask Akahu directly, writing nothing.
 *
 * Read-only on purpose: this is the first thing to run against live tokens,
 * before the baseline pull commits anything to the database. If the history is
 * shallower than hoped, better to find out from a report than from a database
 * you now have to clear out.
 */
export async function probeHistory(
  gateway: AkahuGateway = createGateway(),
  now: Date = new Date(),
): Promise<HistoryDepth[]> {
  const accounts = await gateway.listAccounts();
  const results: HistoryDepth[] = [];

  for (const account of accounts) {
    if (!account.supportsTransactions) {
      results.push({
        accountName: `${account.connectionName ?? "?"} ${account.akahuName}`,
        connectionName: account.connectionName,
        supportsTransactions: false,
        transactionCount: 0,
        earliest: null,
        latest: null,
        monthsOfHistory: null,
        coversFy2027: false,
      });
      continue;
    }

    const transactions = await gateway.listTransactions(
      account.akahuId,
      baselineWindow(now),
    );

    const dates = transactions.map((t) => t.date.getTime()).sort((a, b) => a - b);
    const earliest = dates.length > 0 ? new Date(dates[0]) : null;
    const latest = dates.length > 0 ? new Date(dates[dates.length - 1]) : null;

    results.push({
      accountName: `${account.connectionName ?? "?"} ${account.akahuName}`,
      connectionName: account.connectionName,
      supportsTransactions: true,
      transactionCount: transactions.length,
      earliest,
      latest,
      monthsOfHistory: earliest ? monthsBetween(earliest, now) : null,
      // NZ financial years run 01/04–31/03 and are named for the year they
      // end in, so FY2027 begins 01/04/2026.
      coversFy2027: earliest
        ? earliest.getTime() <= Date.UTC(2026, 3, 1)
        : false,
    });
  }

  return results;
}

/** Same report, but from what we've already stored. Cheap, no API calls. */
export async function storedHistoryDepth(
  prisma: PrismaClient,
): Promise<HistoryDepth[]> {
  const accounts = await prisma.account.findMany({ orderBy: { name: "asc" } });
  const results: HistoryDepth[] = [];

  for (const account of accounts) {
    const [count, range] = await Promise.all([
      prisma.transaction.count({ where: { accountId: account.id } }),
      prisma.transaction.aggregate({
        where: { accountId: account.id },
        _min: { date: true },
        _max: { date: true },
      }),
    ]);

    const earliest = range._min.date ?? null;

    results.push({
      accountName: account.name,
      connectionName: account.connectionName,
      supportsTransactions: true,
      transactionCount: count,
      earliest,
      latest: range._max.date ?? null,
      monthsOfHistory: earliest ? monthsBetween(earliest, new Date()) : null,
      coversFy2027: earliest
        ? earliest.getTime() <= Date.UTC(2026, 3, 1)
        : false,
    });
  }

  return results;
}

function monthsBetween(from: Date, to: Date): number {
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  const months = to.getUTCMonth() - from.getUTCMonth();
  const dayAdjustment = to.getUTCDate() < from.getUTCDate() ? -1 : 0;
  return Math.max(0, years * 12 + months + dayAdjustment);
}

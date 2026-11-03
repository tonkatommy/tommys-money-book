// What the app chrome shows on every screen: the sync health dot and the
// "needs a category" count on the nav.
//
// The header indicator is the one place a quietly stopped sync can be seen
// from any screen. A sync that stopped looks exactly like a quiet day, so
// the dot must be computed, never assumed green. It uses the same staleness
// rule as the status page and the worker (`isSyncStale`), so the three can't
// disagree about what "overdue" means.

import { prisma } from "@/lib/prisma";
import type { Book } from "@/generated/prisma/client";
import type { PayPeriod } from "@/lib/budget/period";
import { isSyncStale } from "@/lib/sync/stale";

export type SyncHealth = "ok" | "overdue" | "failing";

/**
 * Failing beats overdue: a run that errored is the more specific diagnosis,
 * and it is usually also why the feed has gone stale.
 *
 * Only the latest *finished* run counts as failing. A run still in progress
 * says nothing yet, and treating RUNNING as a failure would turn the dot red
 * every morning at 07:00 for as long as the sync takes.
 */
export function syncHealth(input: {
  lastSuccess: Date | null;
  latestFinishedStatus: string | null;
  now: Date;
}): SyncHealth {
  if (input.latestFinishedStatus === "FAILED") return "failing";
  if (isSyncStale(input.lastSuccess, input.now)) return "overdue";
  return "ok";
}

export type ShellStatus = {
  health: SyncHealth;
  /** When the last successful sync started, for the header's "Synced 06:04". */
  lastSuccess: Date | null;
  /** Uncategorised transactions in this book, this pay period. */
  uncategorised: number;
};

export async function getShellStatus(
  book: Book,
  period: PayPeriod,
  now: Date = new Date(),
): Promise<ShellStatus> {
  const [lastSuccess, latestFinished, uncategorised] = await Promise.all([
    prisma.syncRun.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    prisma.syncRun.findFirst({
      where: { status: { not: "RUNNING" } },
      orderBy: { startedAt: "desc" },
      select: { status: true },
    }),
    // The same query the Budget warning runs, so the nav count and the
    // banner it links to always agree.
    prisma.transaction.count({
      where: {
        date: { gte: period.start, lte: period.end },
        categoryId: null,
        account: { book },
      },
    }),
  ]);

  return {
    health: syncHealth({
      lastSuccess: lastSuccess?.startedAt ?? null,
      latestFinishedStatus: latestFinished?.status ?? null,
      now,
    }),
    lastSuccess: lastSuccess?.startedAt ?? null,
    uncategorised,
  };
}

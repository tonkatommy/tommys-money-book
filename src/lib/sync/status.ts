// The data behind the sync status page.
//
// Kept out of the component so the "what counts as a problem?" rules live in
// one testable place rather than tangled up with JSX. The page renders this;
// it doesn't decide it.

import { prisma } from "@/lib/prisma";
import type { Book } from "@/generated/prisma/client";
import { PERSISTENT_DRIFT_HOURS, isDriftPersistent } from "./reconcile";

/**
 * How long without a successful sync before we call it stale.
 *
 * The worker runs daily, so 36 hours means one missed morning triggers the
 * warning while a normal overnight gap never does. This is the single most
 * valuable alert on the page: a sync that has quietly stopped looks exactly
 * like a sync that has nothing to do.
 */
export const STALE_AFTER_HOURS = 36;

export type AccountStatusView = {
  id: string;
  name: string;
  book: Book | null;
  akahuStatus: "ACTIVE" | "INACTIVE";
  balanceCents: number | null;
  transactionCount: number;
  historyStartDate: Date | null;
  lastTransactionAt: Date | null;
  driftCents: number | null;
  /** Non-zero drift on the last two or more runs — a real gap, not a blip. */
  driftIsPersistent: boolean;
  /**
   * Unsettled card authorisations. Not a problem — the bank's balance already
   * includes them and reconciliation accounts for them — but worth showing,
   * because it explains why the balance differs from what has actually
   * cleared.
   */
  pendingTotalCents: number;
  lastSyncedAt: Date | null;
};

export type RunView = {
  id: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  inserted: number;
  duplicates: number;
  error: string | null;
};

export type Alert = {
  level: "error" | "warning";
  message: string;
};

export type SyncStatusView = {
  accounts: AccountStatusView[];
  runs: RunView[];
  lastSuccessfulRun: Date | null;
  alerts: Alert[];
};

export async function getSyncStatus(
  now: Date = new Date(),
): Promise<SyncStatusView> {
  const [accountRows, runRows, lastSuccess] = await Promise.all([
    prisma.account.findMany({
      orderBy: { name: "asc" },
      include: {
        // Enough history to measure how long drift has lasted, not just how
        // many runs it spanned. On the daily schedule 20 results is about
        // three weeks; it only falls short if someone triggers 20+ manual
        // syncs inside 24 hours, which Akahu's 1-hour refresh limit prevents
        // in live mode anyway.
        syncResults: {
          orderBy: { syncRun: { startedAt: "desc" } },
          take: 20,
          include: { syncRun: true },
        },
        _count: { select: { transactions: true } },
      },
    }),
    prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
      include: { accounts: true },
    }),
    prisma.syncRun.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const accounts: AccountStatusView[] = accountRows.map((account) => {
    const recent = account.syncResults;
    const latest = recent[0];

    const driftHistory = recent.map((result) => ({
      driftCents: result.driftCents,
      observedAt: result.syncRun.startedAt,
    }));

    return {
      id: account.id,
      name: account.name,
      book: account.book,
      akahuStatus: account.status,
      balanceCents: account.balanceCents,
      transactionCount: account._count.transactions,
      historyStartDate: account.historyStartDate,
      lastTransactionAt: account.lastTransactionAt,
      driftCents: latest?.driftCents ?? null,
      driftIsPersistent: isDriftPersistent(driftHistory),
      pendingTotalCents: account.pendingTotalCents,
      lastSyncedAt: latest?.syncRun.startedAt ?? null,
    };
  });

  const runs: RunView[] = runRows.map((run) => ({
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.finishedAt
      ? run.finishedAt.getTime() - run.startedAt.getTime()
      : null,
    inserted: run.accounts.reduce((total, a) => total + a.inserted, 0),
    duplicates: run.accounts.reduce((total, a) => total + a.duplicates, 0),
    error: run.error,
  }));

  return {
    accounts,
    runs,
    lastSuccessfulRun: lastSuccess?.startedAt ?? null,
    alerts: buildAlerts({ accounts, runs, lastSuccess: lastSuccess?.startedAt ?? null, now }),
  };
}

/**
 * Turn the raw state into things worth telling a human.
 *
 * Ordered most-urgent first, and deliberately short: a page that always shows
 * five warnings is a page nobody reads, which defeats the point of having
 * warnings at all.
 */
function buildAlerts(input: {
  accounts: AccountStatusView[];
  runs: RunView[];
  lastSuccess: Date | null;
  now: Date;
}): Alert[] {
  const { accounts, runs, lastSuccess, now } = input;
  const alerts: Alert[] = [];

  // 1. Connections needing re-consent. Nothing else matters if the bank has
  //    locked us out — every other number on the page is quietly frozen.
  for (const account of accounts.filter((a) => a.akahuStatus === "INACTIVE")) {
    alerts.push({
      level: "error",
      message:
        `${account.name}: Akahu has lost access to this account. ` +
        `Reconnect it at my.akahu.nz — its data is frozen until you do.`,
    });
  }

  // 2. The sync has stopped.
  if (runs.length === 0) {
    alerts.push({
      level: "warning",
      message: "No sync has ever run. Start with `npm run sync:baseline`.",
    });
  } else if (!lastSuccess) {
    alerts.push({
      level: "error",
      message: "Every sync so far has failed. Check the worker logs.",
    });
  } else {
    const hoursSince = (now.getTime() - lastSuccess.getTime()) / 3_600_000;
    if (hoursSince > STALE_AFTER_HOURS) {
      alerts.push({
        level: "error",
        message:
          `No successful sync in ${Math.floor(hoursSince)} hours. ` +
          `The worker runs daily — check \`docker compose logs worker\`.`,
      });
    }
  }

  // 3. The most recent run went badly.
  const latestRun = runs[0];
  if (latestRun?.status === "FAILED") {
    alerts.push({
      level: "error",
      message: `The last sync failed${latestRun.error ? `: ${latestRun.error}` : "."}`,
    });
  } else if (latestRun?.status === "PARTIAL") {
    alerts.push({
      level: "warning",
      message: "The last sync completed but at least one account failed.",
    });
  }

  // 4. Persistent drift. Drift on a single run — or on several runs in quick
  //    succession — is usually a payment that has hit the balance but hasn't
  //    settled into the transaction feed yet. Only drift that outlives a full
  //    daily cycle is worth raising.
  for (const account of accounts.filter((a) => a.driftIsPersistent)) {
    alerts.push({
      level: "warning",
      message:
        `${account.name}: balance drift has lasted at least ` +
        `${PERSISTENT_DRIFT_HOURS} hours. Transactions are probably missing — ` +
        `a pending payment would have settled by now.`,
    });
  }

  // 5. Accounts with no book. Not urgent, but they can't appear in any report
  //    until assigned, so it shouldn't be forgotten either.
  const unassigned = accounts.filter((a) => a.book === null);
  if (unassigned.length > 0) {
    alerts.push({
      level: "warning",
      message:
        `${unassigned.length} account(s) are not assigned to a set of books. ` +
        `Run \`npm run accounts:map\`.`,
    });
  }

  return alerts;
}

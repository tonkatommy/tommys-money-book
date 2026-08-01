// The sync itself: fetch, import, reconcile, log.
//
// One entry point (`runSync`) used by the baseline CLI, the daily CLI, and the
// cron worker. Having a single code path means the thing you test at 9pm on a
// Sunday is the thing that runs at 7am on Monday.

import type { Account, PrismaClient } from "@/generated/prisma/client";
import { createGateway, type AkahuGateway } from "@/lib/akahu";
import { formatNZD } from "@/lib/money";
import {
  categoriseImported,
  earliestTransactionDate,
  importTransactions,
  latestTransactionDate,
  storedTotalCents,
  upsertAccounts,
  type ImportCounts,
} from "./import";
import {
  isDriftWorthWarningAbout,
  reconcileAccount,
  resolveOpeningBalanceCents,
} from "./reconcile";
import { baselineWindow, incrementalWindow, lookbackDaysFromEnv } from "./window";

export type SyncMode = "baseline" | "incremental";

export type SyncOptions = {
  prisma: PrismaClient;
  gateway?: AkahuGateway;
  mode: SyncMode;
  trigger: "BASELINE" | "SCHEDULED" | "MANUAL";
  now?: Date;
};

export type SyncSummary = {
  syncRunId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  accountsProcessed: number;
  accountsFailed: number;
  totals: ImportCounts;
};

export async function runSync(options: SyncOptions): Promise<SyncSummary> {
  const { prisma, mode, trigger } = options;
  const now = options.now ?? new Date();
  const gateway = options.gateway ?? createGateway();

  const syncRun = await prisma.syncRun.create({
    data: { trigger, status: "RUNNING", startedAt: now },
  });

  console.log(
    `[sync] run ${syncRun.id} started — mode=${mode} trigger=${trigger} ` +
      `source=${gateway.mode}`,
  );

  const totals: ImportCounts = { fetched: 0, inserted: 0, duplicates: 0 };
  let accountsProcessed = 0;
  let accountsFailed = 0;

  try {
    const akahuAccounts = await gateway.listAccounts();
    const accounts = await upsertAccounts(prisma, akahuAccounts);
    console.log(`[sync] ${accounts.length} account(s) from Akahu`);

    // One profile-wide call for every account's unsettled authorisations.
    // The bank's reported balance already includes these, so reconciliation
    // has to subtract them back out — without it, any account with live card
    // activity shows permanent drift. See src/lib/sync/reconcile.ts.
    const pendingByAkahuId = await gateway.pendingTotalsByAccount();
    const pendingCount = pendingByAkahuId.size;
    if (pendingCount > 0) {
      console.log(
        `[sync] ${pendingCount} account(s) have unsettled authorisations`,
      );
    }

    // Index by akahuId so each DB row can find its Akahu counterpart (which
    // carries the balance we reconcile against).
    const byAkahuId = new Map(akahuAccounts.map((a) => [a.akahuId, a]));

    for (const account of accounts) {
      const akahuAccount = account.akahuId
        ? byAkahuId.get(account.akahuId)
        : undefined;

      if (!akahuAccount) continue;

      if (!akahuAccount.supportsTransactions) {
        // Rewards and some investment accounts have balances but no
        // transaction feed. Attempting them would fail every run and make a
        // healthy sync look broken, so skip them loudly-once rather than
        // erroring daily.
        console.log(
          `[sync] skipping "${account.name}" — Akahu reports no transaction feed`,
        );
        continue;
      }

      try {
        const counts = await syncAccount({
          prisma,
          gateway,
          account,
          akahuBalanceCents: akahuAccount.balanceCents,
          // Absent from the map means nothing pending, which is zero — not
          // unknown. Every account Akahu returned was covered by the call.
          pendingTotalCents: pendingByAkahuId.get(akahuAccount.akahuId) ?? 0,
          syncRunId: syncRun.id,
          mode,
          now,
        });

        totals.fetched += counts.fetched;
        totals.inserted += counts.inserted;
        totals.duplicates += counts.duplicates;
        accountsProcessed += 1;
      } catch (err) {
        // Per-account isolation. One bank connection needing re-consent must
        // not stop the other bank from syncing — otherwise a single expired
        // login silently freezes the whole book.
        accountsFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[sync] account "${account.name}" failed: ${message}`);

        await prisma.accountSyncResult.upsert({
          where: {
            syncRunId_accountId: { syncRunId: syncRun.id, accountId: account.id },
          },
          create: { syncRunId: syncRun.id, accountId: account.id, error: message },
          update: { error: message },
        });
      }
    }

    const status =
      accountsFailed === 0
        ? "SUCCESS"
        : accountsProcessed === 0
          ? "FAILED"
          : "PARTIAL";

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status, finishedAt: new Date() },
    });

    console.log(
      `[sync] run ${syncRun.id} ${status} — ` +
        `${totals.inserted} new, ${totals.duplicates} already held, ` +
        `${accountsFailed} account(s) failed`,
    );

    return {
      syncRunId: syncRun.id,
      status,
      accountsProcessed,
      accountsFailed,
      totals,
    };
  } catch (err) {
    // A run-level failure: couldn't even list accounts (Akahu down, tokens
    // rejected, network gone). Record it rather than leaving a RUNNING row
    // that the status page would show as an in-progress sync forever.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: "FAILED", finishedAt: new Date(), error: message },
    });
    console.error(`[sync] run ${syncRun.id} FAILED: ${message}`);
    throw err;
  }
}

async function syncAccount(input: {
  prisma: PrismaClient;
  gateway: AkahuGateway;
  account: Account;
  akahuBalanceCents: number | null;
  pendingTotalCents: number;
  syncRunId: string;
  mode: SyncMode;
  now: Date;
}): Promise<ImportCounts> {
  const {
    prisma,
    gateway,
    account,
    akahuBalanceCents,
    pendingTotalCents,
    syncRunId,
    mode,
    now,
  } = input;

  const window =
    mode === "baseline"
      ? baselineWindow(now)
      : incrementalWindow(account.lastTransactionAt, {
          now,
          lookbackDays: lookbackDaysFromEnv(),
        });

  const transactions = await gateway.listTransactions(account.akahuId!, window);
  const counts = await importTransactions(prisma, account.id, transactions);

  // Categorise what just landed. Scoped to these externalIds and to rows with
  // no category, so the daily job can never revisit an earlier decision.
  //
  // Before the category list exists this is a no-op — there are no rules to
  // match — which is exactly how Phase 1 behaved, so nothing regresses if
  // seeding hasn't been run.
  const categorised = await categoriseImported(
    prisma,
    transactions.map((transaction) => transaction.externalId),
  );

  // Recomputed from the database rather than from what we just imported, so
  // these stay correct even if a previous run was interrupted halfway.
  const [historyStart, lastTransaction, storedTotal] = await Promise.all([
    earliestTransactionDate(prisma, account.id),
    latestTransactionDate(prisma, account.id),
    storedTotalCents(prisma, account.id),
  ]);

  // Derived on the first run that actually holds transactions, and re-derived
  // only if our history later reaches further back. See resolveOpeningBalanceCents
  // for why both halves of that matter — deriving too eagerly bakes in
  // permanent false drift, deriving too often makes the check meaningless.
  const openingBalanceCents = resolveOpeningBalanceCents({
    storedOpeningBalanceCents: account.openingBalanceCents,
    akahuBalanceCents,
    storedTotalCents: storedTotal,
    pendingTotalCents,
    earliestTransactionDate: historyStart,
    previousHistoryStartDate: account.historyStartDate,
  });

  const reconciliation = reconcileAccount({
    akahuBalanceCents,
    openingBalanceCents,
    storedTotalCents: storedTotal,
    pendingTotalCents,
  });

  await prisma.account.update({
    where: { id: account.id },
    data: {
      openingBalanceCents,
      pendingTotalCents,
      historyStartDate: historyStart,
      lastTransactionAt: lastTransaction,
    },
  });

  await prisma.accountSyncResult.upsert({
    where: { syncRunId_accountId: { syncRunId, accountId: account.id } },
    create: {
      syncRunId,
      accountId: account.id,
      ...counts,
      windowStart: window.start,
      windowEnd: window.end,
      akahuBalanceCents,
      computedBalanceCents: reconciliation?.computedBalanceCents ?? null,
      settledBalanceCents: reconciliation?.settledBalanceCents ?? null,
      pendingTotalCents: reconciliation?.pendingTotalCents ?? null,
      driftCents: reconciliation?.driftCents ?? null,
    },
    update: {
      ...counts,
      windowStart: window.start,
      windowEnd: window.end,
      akahuBalanceCents,
      computedBalanceCents: reconciliation?.computedBalanceCents ?? null,
      settledBalanceCents: reconciliation?.settledBalanceCents ?? null,
      pendingTotalCents: reconciliation?.pendingTotalCents ?? null,
      driftCents: reconciliation?.driftCents ?? null,
      error: null,
    },
  });

  console.log(
    `[sync]   ${account.name}: ${counts.inserted} new / ` +
      `${counts.duplicates} already held` +
      (categorised.matched + categorised.unmatched > 0
        ? `, ${categorised.matched} categorised / ${categorised.unmatched} for review`
        : "") +
      (historyStart
        ? `, history from ${historyStart.toISOString().slice(0, 10)}`
        : ""),
  );

  if (isDriftWorthWarningAbout(reconciliation)) {
    console.warn(
      `[sync]   ${account.name}: BALANCE DRIFT ${formatNZD(
        reconciliation!.driftCents,
      )} — Akahu says ${formatNZD(akahuBalanceCents ?? 0)}, ` +
        `our transactions imply ${formatNZD(
          reconciliation!.computedBalanceCents,
        )}. One run of drift is usually a pending transaction; ` +
        `drift that repeats daily means we're missing rows.`,
    );
  }

  return counts;
}

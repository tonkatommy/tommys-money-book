// Reads behind the savings goals screens. Phase 4c spec §6.
//
// Everything here is Prisma; every decision is in `pace.ts` and `warnings.ts`.
// The one rule worth knowing before changing the reads: net flow is every
// transaction on the account, whatever its category, transfer or not. That
// is what "how much did the balance move" means, and it keeps goals clear of
// categorisation and transfer pairing entirely (spec §2). Do not add a
// category or kind filter here.

import { prisma } from "@/lib/prisma";
import {
  nzToday,
  payPeriodFor,
  previousPeriods,
  type PayPeriod,
} from "@/lib/budget/period";
import { HISTORY_PERIODS } from "@/lib/budget/query";
import { isDriftPersistent } from "@/lib/sync/reconcile";
import { countedPeriods, goalPace, type FlowPeriod, type GoalPace } from "./pace";
import { goalWarnings, type GoalWarning } from "./warnings";

export type HistoryRow = FlowPeriod & {
  /**
   * Opening balance plus settled transactions to the period's end. `null`
   * when the account has no derived opening balance, or for a period the
   * feed's history doesn't fully cover, rather than a figure that only looks
   * like a balance.
   */
  closingBalanceCents: number | null;
  /** False for a period before the bank feed's history: shown, not averaged. */
  counted: boolean;
};

export type GoalView = {
  id: string;
  name: string;
  note: string | null;
  targetCents: number;
  targetDate: Date | null;
  archivedAt: Date | null;
  account: { id: string; name: string };
  balanceCents: number | null;
  balanceAsAt: Date | null;
  warnings: GoalWarning[];
  /** `null` when a warning hides the figures, or for an archived goal. */
  pace: GoalPace | null;
  /**
   * The complete periods behind the average, oldest first. Empty when a
   * warning hides the figures, or for an archived goal.
   */
  history: HistoryRow[];
};

/** Enough sync history to measure drift's duration — the same depth /sync reads. */
const DRIFT_RESULTS = 20;

const goalInclude = {
  account: {
    select: {
      id: true,
      name: true,
      book: true,
      status: true,
      connectionName: true,
      balanceCents: true,
      balanceAsAt: true,
      openingBalanceCents: true,
      syncResults: {
        orderBy: { syncRun: { startedAt: "desc" } },
        take: DRIFT_RESULTS,
        select: { driftCents: true, syncRun: { select: { startedAt: true } } },
      },
    },
  },
} as const;

type GoalRow = Awaited<
  ReturnType<typeof prisma.savingsGoal.findMany<{ include: typeof goalInclude }>>
>[number];

/** The running period, and the complete periods behind every average, oldest first. */
function windowFor(now: Date, anchorDay: number): { current: PayPeriod; window: PayPeriod[] } {
  const current = payPeriodFor(nzToday(now), anchorDay);
  // The running period is excluded from the average: on day 5 the payday
  // standing order may or may not have landed, and a partial period reads as
  // a missed one. It is only asked one question, below: has anything landed?
  return { current, window: previousPeriods(current, HISTORY_PERIODS, anchorDay).reverse() };
}

/**
 * Where each bank's feed history begins: the earliest first transaction
 * across every account at that bank (Akahu's connection).
 *
 * Per bank, not per account, because an account's own `historyStartDate` is
 * its first transaction, and a dormant bucket's first transaction says
 * nothing about how far back the feed reaches (`countedPeriods` in pace.ts
 * has the failure that caused). Akahu's reach is a property of the bank. The
 * minimum of first transactions can only be on or after the feed's true
 * start, so it never admits a truncated period.
 */
async function coverageStarts(): Promise<Map<string, Date>> {
  const rows = await prisma.account.groupBy({
    by: ["connectionName"],
    where: { connectionName: { not: null }, historyStartDate: { not: null } },
    _min: { historyStartDate: true },
  });
  const starts = new Map<string, Date>();
  for (const row of rows) {
    if (row.connectionName && row._min.historyStartDate) {
      starts.set(row.connectionName, row._min.historyStartDate);
    }
  }
  return starts;
}

/**
 * Has any money come in on the account during the running period?
 *
 * Any positive transaction, interest included: once this period's money has
 * landed, the next contribution is next payday's (`periodsLeft` in pace.ts).
 * Inflow rather than net flow, so a withdrawal the same week doesn't make an
 * already-paid period look unpaid.
 */
async function hasInflowIn(accountId: string, period: PayPeriod): Promise<boolean> {
  const count = await prisma.transaction.count({
    where: {
      accountId,
      amountCents: { gt: 0 },
      date: { gte: period.start, lte: period.end },
    },
  });
  return count > 0;
}

/**
 * Net flow per period, plus the closing balance where it can be known.
 *
 * One `_sum` per period, reusing the period's own bounds, rather than one
 * findMany bucketed in JavaScript: the boundary stays `period.start` and
 * `period.end`, defined once in `period.ts`.
 */
async function historyFor(
  goal: GoalRow,
  window: PayPeriod[],
  coverageStart: Date | null,
): Promise<HistoryRow[]> {
  const accountId = goal.account.id;
  const sum = async (date: { gte?: Date; lte?: Date; lt?: Date }) =>
    (
      await prisma.transaction.aggregate({
        _sum: { amountCents: true },
        where: { accountId, date },
      })
    )._sum.amountCents ?? 0;

  const [before, ...flows] = await Promise.all([
    sum({ lt: window[0].start }),
    ...window.map((period) => sum({ gte: period.start, lte: period.end })),
  ]);

  const counted = new Set(
    countedPeriods(
      window.map((period, i) => ({ period, netFlowCents: flows[i] })),
      coverageStart,
    ).map((entry) => entry.period.start.getTime()),
  );

  const opening = goal.account.openingBalanceCents;
  let running = opening === null ? null : opening + before;

  return window.map((period, i) => {
    if (running !== null) running += flows[i];
    const isCounted = counted.has(period.start.getTime());
    return {
      period,
      netFlowCents: flows[i],
      // Only where the data covers the whole period. Before the feed's
      // history begins, opening + flows is not the balance at all, just the
      // opening balance repeated backwards over months the data can't see.
      // Inside it, a period before the account's first transaction really
      // did close at the opening balance: nothing moved. Same boundary as
      // the average, so a starred row carries no figure we can't stand behind.
      closingBalanceCents: isCounted ? running : null,
      counted: isCounted,
    };
  });
}

async function toView(
  goal: GoalRow,
  periods: { current: PayPeriod; window: PayPeriod[] },
  coverage: Map<string, Date>,
  now: Date,
  anchorDay: number,
): Promise<GoalView> {
  const { account } = goal;
  const coverageStart =
    account.connectionName === null ? null : (coverage.get(account.connectionName) ?? null);

  const warnings = goalWarnings(
    {
      name: account.name,
      book: account.book,
      status: account.status,
      balanceCents: account.balanceCents,
      balanceAsAt: account.balanceAsAt,
      driftIsPersistent: isDriftPersistent(
        account.syncResults.map((result) => ({
          driftCents: result.driftCents,
          observedAt: result.syncRun.startedAt,
        })),
      ),
    },
    now,
  );

  const active = goal.archivedAt === null;
  const hidden = warnings.some((warning) => warning.hidesFigures);
  // A warning that hides the figures hides ALL of them. The history table is
  // figures too: for an account that has moved to the business book it would
  // put business flows and balances on a personal-only page, under a warning
  // saying the goal isn't tracked.
  const [history, currentPeriodHasInflow] = active && !hidden
    ? await Promise.all([
        historyFor(goal, periods.window, coverageStart),
        hasInflowIn(account.id, periods.current),
      ])
    : [[], false];

  return {
    id: goal.id,
    name: goal.name,
    note: goal.note,
    targetCents: goal.targetCents,
    targetDate: goal.targetDate,
    archivedAt: goal.archivedAt,
    account: { id: account.id, name: account.name },
    balanceCents: account.balanceCents,
    balanceAsAt: account.balanceAsAt,
    warnings,
    pace:
      active && !hidden && account.balanceCents !== null
        ? goalPace({
            balanceCents: account.balanceCents,
            targetCents: goal.targetCents,
            targetDate: goal.targetDate,
            coverageStart,
            history,
            currentPeriodHasInflow,
            today: nzToday(now),
            anchorDay,
          })
        : null,
    history,
  };
}

/**
 * Every goal: active ones with their pace, soonest target first and undated
 * ones after by name; archived ones bare, most recently archived first.
 */
export async function getGoals(
  anchorDay: number,
  now: Date,
): Promise<{ active: GoalView[]; archived: GoalView[] }> {
  const rows = await prisma.savingsGoal.findMany({
    include: goalInclude,
    orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });

  const periods = windowFor(now, anchorDay);
  const coverage = await coverageStarts();
  const views = await Promise.all(
    rows.map((row) => toView(row, periods, coverage, now, anchorDay)),
  );

  return {
    active: views.filter((view) => view.archivedAt === null),
    archived: views
      .filter((view) => view.archivedAt !== null)
      .sort((a, b) => b.archivedAt!.getTime() - a.archivedAt!.getTime()),
  };
}

export async function getGoalDetail(
  id: string,
  anchorDay: number,
  now: Date,
): Promise<GoalView | null> {
  const [row, coverage] = await Promise.all([
    prisma.savingsGoal.findUnique({ where: { id }, include: goalInclude }),
    coverageStarts(),
  ]);
  if (!row) return null;
  return toView(row, windowFor(now, anchorDay), coverage, now, anchorDay);
}

export type AccountOption = {
  id: string;
  name: string;
  /** The goal already tracking this account, if any. A hint; mutate.ts is the guard. */
  activeGoal: { id: string; name: string } | null;
};

/**
 * Accounts a goal can point at: PERSONAL, with an `akahuId`.
 *
 * Not filtered by `accountType` (agreed 01/10/2026): Tommy knows which
 * buckets are savings and the app doesn't, and a filter built on a guess at
 * what Akahu calls an ANZ bucket could hide the very account a goal was for.
 */
export async function getGoalAccountOptions(): Promise<AccountOption[]> {
  const accounts = await prisma.account.findMany({
    where: { book: "PERSONAL", akahuId: { not: null } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      savingsGoals: {
        where: { archivedAt: null },
        select: { id: true, name: true },
        take: 1,
      },
    },
  });

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    activeGoal: account.savingsGoals[0] ?? null,
  }));
}

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
   * when the account has no derived opening balance, rather than a figure
   * missing everything before the first import.
   */
  closingBalanceCents: number | null;
  /** False for a period before `historyStartDate`: shown, not averaged. */
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
  /** The complete periods behind the average, oldest first. */
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
      balanceCents: true,
      balanceAsAt: true,
      historyStartDate: true,
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

/** The complete periods behind every average, oldest first. */
function windowFor(now: Date, anchorDay: number): PayPeriod[] {
  const current = payPeriodFor(nzToday(now), anchorDay);
  // The running period is excluded: on day 5 the payday standing order may
  // or may not have landed, and a partial period reads as a missed one.
  return previousPeriods(current, HISTORY_PERIODS, anchorDay).reverse();
}

/**
 * Net flow per period, plus the closing balance where it can be known.
 *
 * One `_sum` per period, reusing the period's own bounds, rather than one
 * findMany bucketed in JavaScript: the boundary stays `period.start` and
 * `period.end`, defined once in `period.ts`.
 */
async function historyFor(goal: GoalRow, window: PayPeriod[]): Promise<HistoryRow[]> {
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
      goal.account.historyStartDate,
    ).map((entry) => entry.period.start.getTime()),
  );

  const opening = goal.account.openingBalanceCents;
  let running = opening === null ? null : opening + before;

  return window.map((period, i) => {
    if (running !== null) running += flows[i];
    return {
      period,
      netFlowCents: flows[i],
      closingBalanceCents: running,
      counted: counted.has(period.start.getTime()),
    };
  });
}

async function toView(
  goal: GoalRow,
  window: PayPeriod[],
  now: Date,
  anchorDay: number,
): Promise<GoalView> {
  const { account } = goal;

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
  const history = active ? await historyFor(goal, window) : [];

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
            historyStartDate: account.historyStartDate,
            history,
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

  const window = windowFor(now, anchorDay);
  const views = await Promise.all(rows.map((row) => toView(row, window, now, anchorDay)));

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
  const row = await prisma.savingsGoal.findUnique({ where: { id }, include: goalInclude });
  if (!row) return null;
  return toView(row, windowFor(now, anchorDay), now, anchorDay);
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

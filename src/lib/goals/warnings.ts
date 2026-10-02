// When the balance behind a goal can't be trusted. Phase 4c spec §6.
//
// A goal is only as good as the balance under it, so each goal carries its
// own data-quality lines, worded for that goal, rather than sending Tommy to
// /sync to work out whether a red banner there applies here. Pure, for the
// same reason `sync/status.ts` keeps its rules out of the component: the page
// renders these, it doesn't decide them.
//
// Two of them replace the figures rather than sitting beside them (`hidesFigures`):
// an account that has left the personal book, and one with no balance at all.
// The goal still renders, with the warning where the numbers would be. A goal
// that silently drops off the list because its account was remapped is a
// goal nobody notices has stopped being tracked.

import type { AccountStatus, Book } from "@/generated/prisma/client";
import { nzDate, nzToday } from "@/lib/budget/period";
import { isSyncStale } from "@/lib/sync/stale";

export type GoalWarning = {
  level: "error" | "warning";
  message: string;
  /** Show this instead of the goal's figures, not alongside them. */
  hidesFigures: boolean;
};

export type GoalAccountState = {
  name: string;
  book: Book | null;
  status: AccountStatus;
  balanceCents: number | null;
  balanceAsAt: Date | null;
  /** From `isDriftPersistent` over the account's recent sync results. */
  driftIsPersistent: boolean;
};

export function goalWarnings(account: GoalAccountState, now: Date): GoalWarning[] {
  const warnings: GoalWarning[] = [];

  if (account.book !== "PERSONAL") {
    warnings.push({
      level: "error",
      message:
        account.book === null
          ? `${account.name} is no longer assigned to a book, so this goal isn't being tracked. Archive it, or map the account back to personal.`
          : `${account.name} has moved to the business book, so this goal isn't being tracked. Archive it, or move the account back.`,
      hidesFigures: true,
    });
  }

  if (account.balanceCents === null) {
    warnings.push({
      level: "error",
      message: `No balance from the bank for ${account.name} yet. It appears after the next sync.`,
      hidesFigures: true,
    });
  }

  if (account.status === "INACTIVE") {
    warnings.push({
      level: "error",
      message: `The bank connection for ${account.name} needs re-consenting in Akahu. Until then the balance is frozen at its last value.`,
      hidesFigures: false,
    });
  }

  // `isSyncStale` treats null as stale already: `normaliseAccount` sets the
  // balance and its date independently, so a balance can arrive undated, and
  // an undated balance must not be presented as current. One definition of
  // stale, shared with /sync and the worker.
  if (account.balanceCents !== null && isSyncStale(account.balanceAsAt, now)) {
    warnings.push({
      level: "warning",
      message:
        account.balanceAsAt === null
          ? `The bank didn't say when ${account.name}'s balance was taken, so it may not be current.`
          : // The date of an instant, in NZ: `nzToday` resolves the calendar
            // day where Tommy is, which `nzDate` alone (UTC fields) would not.
            `${account.name}'s balance was last updated ${nzDate(nzToday(account.balanceAsAt))}, so it may not be current.`,
      hidesFigures: false,
    });
  }

  if (account.driftIsPersistent) {
    warnings.push({
      level: "warning",
      message: `${account.name} hasn't reconciled with the bank for over a day, so the contributions below may be missing transactions. The balance itself is the bank's.`,
      hidesFigures: false,
    });
  }

  return warnings;
}

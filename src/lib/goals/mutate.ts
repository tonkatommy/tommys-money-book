// Writes behind the savings goals screens. Phase 4c spec §5.
//
// Same split as `budget/mutate.ts` and `reports/mutate.ts`: parsing here, in a
// plain module, so it is unit-testable without a request context; the
// "use server" actions are thin wrappers. Every write returns a result union
// instead of throwing, so a refused save re-renders the form with a message.
//
// Two guards, and both are re-derived from the database rather than taken
// from the form, because a Server Action is reachable as a direct POST
// (invariant 6):
//
// 1. THE ACCOUNT. A goal measures its account's Akahu balance, so the account
//    must exist, carry an `akahuId` (the cash accounts have no bank balance),
//    and be in the PERSONAL book. The account id from the form names a
//    record; the record decides its own book (code-review skill §1).
//
// 2. ONE ACTIVE GOAL PER ACCOUNT. Two goals on one bucket would each claim
//    the whole balance. The database enforces it with a partial unique index;
//    the check here only exists to word the refusal. Under READ COMMITTED a
//    check-then-insert lets two concurrent writes both pass, so the loser's
//    P2002 is caught and given the same message.
//
// Both run on every write that makes a goal active — create, edit, unarchive.
// Archiving runs neither: it takes a goal out of tracking, so it can't create
// a clash or a book leak, and it has to work on exactly the goals that fail
// guard 1, such as one whose account has since moved to the business book.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { parseDollarsToCents } from "@/lib/budget/mutate";
import { parseDateParam } from "@/lib/transactions/query";

export type MutationResult = { ok: true } | { ok: false; error: string };

/**
 * Create or edit. Passed by the action that knows which it is, never read
 * from the form: a hidden field would let a direct POST claim to be an edit
 * and slip a past date past the create-only rule.
 */
export type GoalMode = "create" | "edit";

export type GoalInput = {
  name: string;
  accountId: string;
  targetCents: number;
  targetDate: Date | null;
  note: string | null;
};

export const GOAL_NAME_MAX = 80;

/** The form fields, for echoing back on a refused save. */
export const GOAL_FIELDS = ["name", "accountId", "target", "targetDate", "note"] as const;

/**
 * Parse the goal form.
 *
 * `today` is `nzToday()`, a UTC-midnight calendar date (invariant 5). A
 * target date must be after it on create. On edit a past date is allowed, so
 * a goal that missed its date can be kept and re-dated rather than refused.
 */
export function parseGoalForm(
  form: FormData,
  today: Date,
  mode: GoalMode,
): { ok: true; goal: GoalInput } | { ok: false; error: string } {
  const name = String(form.get("name") ?? "").trim();
  if (name === "") return { ok: false, error: "Give the goal a name." };
  if (name.length > GOAL_NAME_MAX) {
    return { ok: false, error: `Keep the name to ${GOAL_NAME_MAX} characters.` };
  }

  const accountId = String(form.get("accountId") ?? "").trim();
  if (accountId === "") return { ok: false, error: "Choose the account the goal is saved in." };

  // Through `parseDollarsToCents`, so the form boundary rounds exactly as
  // every other money field does (invariant 2).
  const targetCents = parseDollarsToCents(form.get("target"));
  if (targetCents === null) return { ok: false, error: "The target is not a dollar amount." };
  if (targetCents <= 0) return { ok: false, error: "The target has to be more than $0." };

  const dateText = String(form.get("targetDate") ?? "").trim();
  let targetDate: Date | null = null;
  if (dateText !== "") {
    // `parseDateParam` refuses 2027-02-31 rather than rolling it into March,
    // which `new Date(string)` would do without a word.
    targetDate = parseDateParam(dateText);
    if (targetDate === null) {
      return { ok: false, error: "The target date is not a real date. Use YYYY-MM-DD." };
    }
    if (mode === "create" && targetDate.getTime() <= today.getTime()) {
      return { ok: false, error: "The target date has to be after today." };
    }
  }

  const note = String(form.get("note") ?? "").trim();

  return {
    ok: true,
    goal: { name, accountId, targetCents, targetDate, note: note === "" ? null : note },
  };
}

/** A refusal raised inside a transaction, to roll it back with a message. */
class Refused extends Error {}

/** Turn any thrown error into something safe to show. Matches budget/mutate.ts. */
function failed(context: string, error: unknown): { ok: false; error: string } {
  if (error instanceof Refused) return { ok: false, error: error.message };
  console.error(`[goals] ${context} failed`, error);
  return {
    ok: false,
    error:
      process.env.NODE_ENV === "production"
        ? "Saving failed. Check the server logs."
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

const CLASH = "That account already has an active goal. Archive it first, or pick another account.";

/** The partial unique index refusing a second active goal on one account. */
function isClash(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

type Tx = Prisma.TransactionClient;

/**
 * Guards 1 and 2, for a write that makes `goalId` (or a new goal) active on
 * `accountId`. Throws `Refused` so the surrounding transaction rolls back.
 */
async function assertCanTrack(tx: Tx, accountId: string, goalId: string | null): Promise<void> {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { name: true, book: true, akahuId: true },
  });

  if (!account) throw new Refused("That account no longer exists. Reload and try again.");
  if (account.akahuId === null) {
    throw new Refused(
      `${account.name} isn't fed by the bank, so there's no balance to measure a goal against.`,
    );
  }
  // Null is "not yet mapped", and defaulting it to PERSONAL is a book leak.
  if (account.book === null) {
    throw new Refused(
      `${account.name} hasn't been put in a book yet. Map it with npm run accounts:map first.`,
    );
  }
  if (account.book !== "PERSONAL") {
    throw new Refused(`${account.name} is in the business book. Savings goals are personal only.`);
  }

  const other = await tx.savingsGoal.findFirst({
    where: {
      accountId,
      archivedAt: null,
      ...(goalId === null ? {} : { id: { not: goalId } }),
    },
    select: { name: true },
  });
  if (other) {
    throw new Refused(
      `${account.name} already has an active goal, "${other.name}". Archive it first, or pick another account.`,
    );
  }
}

export async function createGoal(
  input: GoalInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const goal = await prisma.$transaction(async (tx) => {
      await assertCanTrack(tx, input.accountId, null);
      return tx.savingsGoal.create({ data: input, select: { id: true } });
    });
    return { ok: true, id: goal.id };
  } catch (error) {
    if (isClash(error)) return { ok: false, error: CLASH };
    return failed("createGoal", error);
  }
}

/**
 * Edit an active goal.
 *
 * The account is re-checked even when it didn't change: a goal whose account
 * has since moved books can't be edited back into being tracked, only
 * archived. An archived goal can't be edited at all until it is unarchived,
 * which is where its account gets re-checked — otherwise an edit would have
 * to either skip the checks or clash with whichever goal has since taken
 * over the bucket.
 */
export async function updateGoal(id: string, input: GoalInput): Promise<MutationResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const goal = await tx.savingsGoal.findUnique({
        where: { id },
        select: { archivedAt: true },
      });
      if (!goal) throw new Refused("That goal no longer exists.");
      if (goal.archivedAt !== null) {
        throw new Refused("That goal is archived. Unarchive it before editing.");
      }

      await assertCanTrack(tx, input.accountId, id);
      await tx.savingsGoal.update({ where: { id }, data: input });
    });
    return { ok: true };
  } catch (error) {
    if (isClash(error)) return { ok: false, error: CLASH };
    return failed("updateGoal", error);
  }
}

/** Put a goal away. No account checks — see the header. */
export async function archiveGoal(id: string): Promise<MutationResult> {
  try {
    // `archivedAt: null` in the filter keeps the original archive date if the
    // button is pressed twice.
    const { count } = await prisma.savingsGoal.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (count === 0) {
      const exists = await prisma.savingsGoal.count({ where: { id } });
      if (exists === 0) return { ok: false, error: "That goal no longer exists." };
    }
    return { ok: true };
  } catch (error) {
    return failed("archiveGoal", error);
  }
}

/**
 * Bring a goal back. Runs both guards: unarchiving can create a clash just as
 * creating can, and the account may have moved books while it was archived.
 */
export async function unarchiveGoal(id: string): Promise<MutationResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const goal = await tx.savingsGoal.findUnique({
        where: { id },
        select: { accountId: true, archivedAt: true },
      });
      if (!goal) throw new Refused("That goal no longer exists.");
      if (goal.archivedAt === null) return;

      await assertCanTrack(tx, goal.accountId, id);
      await tx.savingsGoal.update({ where: { id }, data: { archivedAt: null } });
    });
    return { ok: true };
  } catch (error) {
    if (isClash(error)) return { ok: false, error: CLASH };
    return failed("unarchiveGoal", error);
  }
}

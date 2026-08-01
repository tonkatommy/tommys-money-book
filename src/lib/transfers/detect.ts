// Finding the two legs of a transfer and proving they're the same movement.
//
// Money moving between your own accounts is neither income nor an expense.
// Get this wrong in one direction and the books show phantom income; get it
// wrong in the other and real income disappears. Both errors leave a
// perfectly balanced set of books, so nothing complains.
//
// The baseline supports exactly one class of automatic pairing, and it is
// worth understanding why only one:
//
//   Tier 1 — ANZ writes structured descriptions. Both legs name the *other*
//     account and the account numbers are ones we hold. 403 of 404 outgoing
//     legs match with zero unmatched internal legs. This is a fact about the
//     data, not a heuristic, so it can be applied automatically.
//
//   Tier 2 — standing orders between the same accounts, and money moving
//     between the personal and business books. Real, regular, and inferable
//     from context, but not provable from the description alone. Suggested,
//     confirmed by a human.
//
//   Tier 3 — everything else. Not attempted. Blind same-day ±amount matching
//     across accounts produces 933 candidates over the baseline, and among
//     them is a standing order that collides with a genuine flatmate payment
//     on the same day for the same amount seventeen separate times. Netting
//     those would erase $1,360 of real income invisibly.

import type { Book } from "@/generated/prisma/client";

/** An account number as the banks format it: 06-0878-0335888-03. */
const ACCOUNT_NUMBER = /\d{2}-\d{4}-\d{7}-\d{2}/;

export type TransferLeg = {
  id: string;
  accountId: string;
  date: Date;
  amountCents: number;
  description: string;
};

export type ParsedLeg = {
  direction: "OUT" | "IN";
  /** The account named in the description — the *other* side. */
  counterpartyNumber: string;
  /** Free text after the account number: "afterpay", "rent", "Debit Transfer 151054". */
  label: string;
};

/**
 * Read an ANZ internal transfer description.
 *
 *   "To:   06-0878-0335888-03 afterpay"  -> OUT, counterparty -03
 *   "From: 06-0878-0335888-00 afterpay"  -> IN,  counterparty -00
 *
 * Returns null for anything that isn't in this form, which is how non-ANZ
 * and non-transfer rows fall through to tier 2 rather than being guessed at.
 */
export function parseTransferLeg(description: string): ParsedLeg | null {
  const match = /^(to|from):\s*(\S+)\s*(.*)$/i.exec(description.trim());
  if (!match) return null;

  const [, direction, account, label] = match;
  if (!ACCOUNT_NUMBER.test(account!)) return null;

  return {
    direction: direction!.toLowerCase() === "to" ? "OUT" : "IN",
    counterpartyNumber: ACCOUNT_NUMBER.exec(account!)![0],
    label: label!.trim().toLowerCase(),
  };
}

export type ResolvedLeg = TransferLeg & {
  parsed: ParsedLeg;
  /** Our account id for the counterparty, or null if it isn't ours. */
  counterpartyAccountId: string | null;
};

export type ConfirmedPair = {
  outLegId: string;
  inLegId: string;
  date: Date;
  /** Always positive — the size of the movement. */
  amountCents: number;
  /** True when several identical candidates existed and any would do. */
  interchangeable: boolean;
};

export type PairingResult = {
  pairs: ConfirmedPair[];
  /** Outgoing legs with no counterpart. Expected to be external accounts. */
  unmatchedOut: ResolvedLeg[];
  /** Incoming legs nothing claimed. Should be empty; non-empty means a bug. */
  unmatchedIn: ResolvedLeg[];
};

/**
 * Pair ANZ internal transfer legs.
 *
 * The match requires date, exactly negated amount, and — the part that makes
 * it deterministic rather than a guess — *reciprocity*: each leg must name
 * the other's account. A leg naming an account we don't hold is deliberately
 * left unpaired; that money left the household and netting it to zero would
 * hide a real payment.
 *
 * The label is a tiebreaker only, never a requirement. When ANZ generates the
 * transfer itself the label carries a per-leg reference number that differs
 * between the two sides ("Debit Transfer 151054" against "Credit Transfer
 * 092335"), and requiring equality drops the match rate from 403 to 109.
 */
export function pairTransferLegs(legs: readonly ResolvedLeg[]): PairingResult {
  const outs = legs
    .filter((leg) => leg.parsed.direction === "OUT")
    // Stable input order so an interchangeable group resolves the same way
    // on every run. Without this the same transaction could pair differently
    // between two runs of the same command.
    .sort((a, b) => a.id.localeCompare(b.id));

  const ins = legs
    .filter((leg) => leg.parsed.direction === "IN")
    .sort((a, b) => a.id.localeCompare(b.id));

  const claimed = new Set<string>();
  const pairs: ConfirmedPair[] = [];
  const unmatchedOut: ResolvedLeg[] = [];

  for (const out of outs) {
    if (out.counterpartyAccountId === null) {
      unmatchedOut.push(out);
      continue;
    }

    // Two sets, and the difference matters. `all` is every leg this one
    // could have paired with; `available` is those not already taken. We
    // choose from `available`, but judge interchangeability against `all` —
    // otherwise the second of two identical transfers looks like a forced
    // choice when in fact the whole group was arbitrary.
    const all = ins.filter(
      (candidate) =>
        candidate.amountCents === -out.amountCents &&
        candidate.date.getTime() === out.date.getTime() &&
        candidate.accountId === out.counterpartyAccountId &&
        candidate.counterpartyAccountId === out.accountId,
    );
    const available = all.filter((candidate) => !claimed.has(candidate.id));

    if (available.length === 0) {
      unmatchedOut.push(out);
      continue;
    }

    // Prefer a candidate whose label agrees. When ANZ generated the transfer
    // the labels won't agree and any candidate is as good as any other —
    // same date, same amount, same pair of accounts, so every assignment
    // produces identical books.
    const exact = available.find(
      (candidate) => candidate.parsed.label === out.parsed.label,
    );
    const chosen = exact ?? available[0]!;

    claimed.add(chosen.id);
    pairs.push({
      outLegId: out.id,
      inLegId: chosen.id,
      date: out.date,
      amountCents: Math.abs(out.amountCents),
      interchangeable: exact === undefined && all.length > 1,
    });
  }

  return {
    pairs,
    unmatchedOut,
    unmatchedIn: ins.filter((leg) => !claimed.has(leg.id)),
  };
}

// ---------------------------------------------------------------------------
// Tier 2 — suggestions
// ---------------------------------------------------------------------------

export type SuggestionAccount = {
  id: string;
  name: string;
  book: Book | null;
  /** Akahu's own name, e.g. "Flat Rent Payments" — the destination hint. */
  akahuName: string | null;
};

export type TransferSuggestion = {
  outLegId: string;
  inLegId: string;
  date: Date;
  amountCents: number;
  outDescription: string;
  inDescription: string;
  fromAccount: string;
  toAccount: string;
  /** Personal -> business (or back): OWNER, not a netting transfer. */
  crossBook: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Why it scored that way, so a wrong suggestion is arguable rather than magic. */
  reasons: string[];
  /** The same outgoing leg has other equally plausible counterparts. */
  contested: boolean;
};

/** How many trailing words two descriptions share, lower-cased. */
export function sharedTrailingWords(a: string, b: string): number {
  const left = a.toLowerCase().split(/\s+/).filter(Boolean);
  const right = b.toLowerCase().split(/\s+/).filter(Boolean);

  let shared = 0;
  while (
    shared < left.length &&
    shared < right.length &&
    left[left.length - 1 - shared] === right[right.length - 1 - shared]
  ) {
    shared += 1;
  }

  return shared;
}

/**
 * Suggest pairs that aren't provable but are probably real.
 *
 * Every plausible counterpart is returned, not just the best one. An
 * outgoing leg with two candidates is exactly the case where a confident
 * single answer would be dangerous — the flatmate collision looks identical
 * to the genuine standing order from the amounts alone — so the collision is
 * put in front of the human rather than resolved on their behalf.
 */
export function suggestTransferPairs(
  outLegs: readonly TransferLeg[],
  inLegs: readonly TransferLeg[],
  accounts: readonly SuggestionAccount[],
): TransferSuggestion[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const suggestions: TransferSuggestion[] = [];

  for (const out of outLegs) {
    const candidates = inLegs.filter(
      (candidate) =>
        candidate.accountId !== out.accountId &&
        candidate.amountCents === -out.amountCents &&
        candidate.date.getTime() === out.date.getTime(),
    );

    for (const candidate of candidates) {
      const fromAccount = accountById.get(out.accountId);
      const toAccount = accountById.get(candidate.accountId);
      const reasons: string[] = [];

      const shared = sharedTrailingWords(out.description, candidate.description);
      if (shared > 0) {
        reasons.push(
          `both legs end with the same ${shared} word(s) — the payment particulars`,
        );
      }

      // ANZ names the destination account in the outgoing description of a
      // standing order: "Flat Rent Payments Rent" pays into "Flat Rent
      // Payments". A strong hint, and one nothing else produces.
      const destinationNamed = Boolean(
        toAccount?.akahuName &&
          out.description
            .toLowerCase()
            .startsWith(toAccount.akahuName.toLowerCase()),
      );
      if (destinationNamed) {
        reasons.push(
          `the outgoing description names the destination account ("${toAccount!.akahuName}")`,
        );
      }

      const crossBook =
        fromAccount?.book != null &&
        toAccount?.book != null &&
        fromAccount.book !== toAccount.book;
      if (crossBook) {
        reasons.push(
          "crosses the personal/business boundary — this is an owner " +
            "contribution or drawing, not a netting transfer",
        );
      }

      const score = (shared > 0 ? 1 : 0) + (destinationNamed ? 1 : 0);

      suggestions.push({
        outLegId: out.id,
        inLegId: candidate.id,
        date: out.date,
        amountCents: Math.abs(out.amountCents),
        outDescription: out.description,
        inDescription: candidate.description,
        fromAccount: fromAccount?.name ?? "(unknown)",
        toAccount: toAccount?.name ?? "(unknown)",
        crossBook,
        confidence: score === 2 ? "HIGH" : score === 1 ? "MEDIUM" : "LOW",
        reasons,
        contested: candidates.length > 1,
      });
    }
  }

  return suggestions.sort(
    (a, b) =>
      b.date.getTime() - a.date.getTime() || b.amountCents - a.amountCents,
  );
}

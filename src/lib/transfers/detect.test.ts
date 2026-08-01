import { describe, expect, it } from "vitest";

import {
  pairTransferLegs,
  parseTransferLeg,
  sharedTrailingWords,
  suggestTransferPairs,
  type ResolvedLeg,
  type SuggestionAccount,
  type TransferLeg,
} from "./detect";

const INCOME_BUCKET = "acct_income_bucket";
const MONEY_CARD = "acct_money_card";
const FLAT_EXPENSES = "acct_flat_expenses";
const BUSINESS = "acct_business";

const DAY = new Date("2026-03-15T00:00:00.000Z");
const NEXT_DAY = new Date("2026-03-16T00:00:00.000Z");

function leg(
  id: string,
  accountId: string,
  amountCents: number,
  description: string,
  date: Date = DAY,
): TransferLeg {
  return { id, accountId, amountCents, description, date };
}

/** Build a ResolvedLeg the way run.ts does, so the tests exercise real parsing. */
function resolve(
  base: TransferLeg,
  counterpartyAccountId: string | null,
): ResolvedLeg {
  const parsed = parseTransferLeg(base.description);
  if (!parsed) throw new Error(`unparseable in test: ${base.description}`);
  return { ...base, parsed, counterpartyAccountId };
}

describe("parseTransferLeg", () => {
  it("reads an outgoing leg and the account it names", () => {
    expect(parseTransferLeg("To: 06-0878-0335888-03 afterpay")).toEqual({
      direction: "OUT",
      counterpartyNumber: "06-0878-0335888-03",
      label: "afterpay",
    });
  });

  it("reads an incoming leg", () => {
    expect(parseTransferLeg("From: 06-0878-0335888-00 rent")).toEqual({
      direction: "IN",
      counterpartyNumber: "06-0878-0335888-00",
      label: "rent",
    });
  });

  it("handles the bank-generated label with its per-leg reference", () => {
    expect(
      parseTransferLeg("To: 06-0878-0335888-03 Debit Transfer 151054")?.label,
    ).toBe("debit transfer 151054");
  });

  it("returns null for anything that isn't this form", () => {
    expect(parseTransferLeg("MONTHLY BANK FEE")).toBeNull();
    expect(parseTransferLeg("Flat Rent Payments Rent")).toBeNull();
    // "To:" without a recognisable account number is not an internal transfer.
    expect(parseTransferLeg("To: someone rent")).toBeNull();
  });
});

describe("pairTransferLegs", () => {
  it("pairs reciprocal legs", () => {
    const out = resolve(
      leg("a", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 afterpay"),
      MONEY_CARD,
    );
    const incoming = resolve(
      leg("b", MONEY_CARD, 5000, "From: 06-0878-0335888-00 afterpay"),
      INCOME_BUCKET,
    );

    const { pairs, unmatchedOut, unmatchedIn } = pairTransferLegs([
      out,
      incoming,
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      outLegId: "a",
      inLegId: "b",
      amountCents: 5000,
    });
    expect(unmatchedOut).toHaveLength(0);
    expect(unmatchedIn).toHaveLength(0);
  });

  it("tolerates labels that disagree", () => {
    // ANZ-generated transfers carry a different reference on each leg. This
    // is the case that drops the real match rate from 403 to 109 if labels
    // are required to be equal.
    const out = resolve(
      leg("a", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 Debit Transfer 151054"),
      MONEY_CARD,
    );
    const incoming = resolve(
      leg("b", MONEY_CARD, 5000, "From: 06-0878-0335888-00 Credit Transfer 092335"),
      INCOME_BUCKET,
    );

    expect(pairTransferLegs([out, incoming]).pairs).toHaveLength(1);
  });

  it("refuses to pair a leg naming an account that isn't ours", () => {
    // The real baseline has exactly one of these — money genuinely leaving
    // the household. Netting it to zero would hide a real payment.
    const out = resolve(
      leg("a", INCOME_BUCKET, -333, "To: 01-0495-0425683-00 Debit Transfer 151704"),
      null,
    );
    const decoy = resolve(
      leg("b", MONEY_CARD, 333, "From: 06-0878-0335888-00 Credit Transfer 151704"),
      INCOME_BUCKET,
    );

    const { pairs, unmatchedOut } = pairTransferLegs([out, decoy]);

    expect(pairs).toHaveLength(0);
    expect(unmatchedOut.map((l) => l.id)).toEqual(["a"]);
  });

  it("requires reciprocity, not just a matching amount", () => {
    // The incoming leg names a third account, so this is not the same
    // movement even though date and amount line up.
    const out = resolve(
      leg("a", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 rent"),
      MONEY_CARD,
    );
    const incoming = resolve(
      leg("b", MONEY_CARD, 5000, "From: 06-0878-0335888-53 rent"),
      FLAT_EXPENSES,
    );

    expect(pairTransferLegs([out, incoming]).pairs).toHaveLength(0);
  });

  it("does not pair across dates", () => {
    const out = resolve(
      leg("a", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 rent"),
      MONEY_CARD,
    );
    const incoming = resolve(
      leg("b", MONEY_CARD, 5000, "From: 06-0878-0335888-00 rent", NEXT_DAY),
      INCOME_BUCKET,
    );

    expect(pairTransferLegs([out, incoming]).pairs).toHaveLength(0);
  });

  it("prefers the candidate whose label agrees", () => {
    const out = resolve(
      leg("a", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 rent"),
      MONEY_CARD,
    );
    const wrongLabel = resolve(
      leg("b", MONEY_CARD, 5000, "From: 06-0878-0335888-00 groceries"),
      INCOME_BUCKET,
    );
    const rightLabel = resolve(
      leg("c", MONEY_CARD, 5000, "From: 06-0878-0335888-00 rent"),
      INCOME_BUCKET,
    );

    const { pairs } = pairTransferLegs([out, wrongLabel, rightLabel]);

    expect(pairs[0]?.inLegId).toBe("c");
  });

  it("resolves interchangeable candidates the same way every run", () => {
    // Two identical transfers between the same accounts on the same day.
    // Either assignment produces identical books, but the choice must be
    // stable or the same command gives different output each time.
    const outs = [
      resolve(leg("a1", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 Debit Transfer 1"), MONEY_CARD),
      resolve(leg("a2", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 Debit Transfer 2"), MONEY_CARD),
    ];
    const ins = [
      resolve(leg("b1", MONEY_CARD, 5000, "From: 06-0878-0335888-00 Credit Transfer 3"), INCOME_BUCKET),
      resolve(leg("b2", MONEY_CARD, 5000, "From: 06-0878-0335888-00 Credit Transfer 4"), INCOME_BUCKET),
    ];

    const forwards = pairTransferLegs([...outs, ...ins]);
    const backwards = pairTransferLegs([...ins.reverse(), ...outs.reverse()]);

    expect(forwards.pairs).toHaveLength(2);
    expect(forwards.pairs).toEqual(backwards.pairs);
    expect(forwards.pairs.every((pair) => pair.interchangeable)).toBe(true);
  });

  it("never claims the same incoming leg twice", () => {
    const outs = [
      resolve(leg("a1", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 rent"), MONEY_CARD),
      resolve(leg("a2", INCOME_BUCKET, -5000, "To: 06-0878-0335888-03 rent"), MONEY_CARD),
    ];
    const ins = [
      resolve(leg("b1", MONEY_CARD, 5000, "From: 06-0878-0335888-00 rent"), INCOME_BUCKET),
    ];

    const { pairs, unmatchedOut } = pairTransferLegs([...outs, ...ins]);

    expect(pairs).toHaveLength(1);
    expect(unmatchedOut).toHaveLength(1);
  });
});

describe("sharedTrailingWords", () => {
  it("counts the shared payment particulars", () => {
    expect(sharedTrailingWords("Flat Expenses Tom Phone", "Goodman,Thoma Tom Phone")).toBe(2);
    expect(sharedTrailingWords("Flat Rent Payments Rent", "Goodman,Thoma Rent")).toBe(1);
  });

  it("is zero when nothing lines up", () => {
    expect(sharedTrailingWords("Monthly Bank Fee", "Goodman,Thoma Rent")).toBe(0);
  });
});

describe("suggestTransferPairs", () => {
  const accounts: SuggestionAccount[] = [
    { id: INCOME_BUCKET, name: "ANZ Income Bucket", book: "PERSONAL", akahuName: "Income Bucket" },
    { id: FLAT_EXPENSES, name: "ANZ Flat Expenses", book: "PERSONAL", akahuName: "Flat Expenses" },
    { id: BUSINESS, name: "BNZ Tommy Tinkers NZ", book: "BUSINESS", akahuName: "Tommy Tinkers NZ" },
  ];

  it("scores a standing order into a named account as HIGH", () => {
    const suggestions = suggestTransferPairs(
      [leg("out", INCOME_BUCKET, -8000, "Flat Expenses Utilities")],
      [leg("in", FLAT_EXPENSES, 8000, "Goodman,Thoma Utilities")],
      accounts,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.confidence).toBe("HIGH");
    expect(suggestions[0]?.contested).toBe(false);
  });

  it("surfaces the flatmate collision instead of resolving it", () => {
    // The case that makes tier 2 manual. A real standing order and a real
    // flatmate payment, same day, same amount — indistinguishable by amount
    // alone, and auto-netting the wrong one erases real income.
    const suggestions = suggestTransferPairs(
      [leg("out", INCOME_BUCKET, -8000, "Flat Expenses Utilities")],
      [
        leg("internal", FLAT_EXPENSES, 8000, "Goodman,Thoma Utilities"),
        leg("flatmate", FLAT_EXPENSES, 8000, "Thomas,Bonnie Utilities"),
      ],
      accounts,
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((s) => s.contested)).toBe(true);
  });

  it("flags a cross-book pair as an owner movement", () => {
    const suggestions = suggestTransferPairs(
      [leg("out", INCOME_BUCKET, -16300, "Tommy Tinkers Nz")],
      [leg("in", BUSINESS, 16300, "GOODMAN,THOMA")],
      accounts,
    );

    expect(suggestions[0]?.crossBook).toBe(true);
    expect(suggestions[0]?.reasons.join(" ")).toContain("owner");
  });

  it("does not suggest a pair within one account", () => {
    expect(
      suggestTransferPairs(
        [leg("out", INCOME_BUCKET, -5000, "something")],
        [leg("in", INCOME_BUCKET, 5000, "something")],
        accounts,
      ),
    ).toHaveLength(0);
  });

  it("gives a reason for every suggestion it makes", () => {
    const suggestions = suggestTransferPairs(
      [leg("out", INCOME_BUCKET, -8000, "Flat Expenses Utilities")],
      [leg("in", FLAT_EXPENSES, 8000, "Goodman,Thoma Utilities")],
      accounts,
    );

    expect(suggestions[0]?.reasons.length).toBeGreaterThan(0);
  });
});

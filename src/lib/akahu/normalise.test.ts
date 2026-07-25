import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "akahu";

import {
  buildAccountName,
  normaliseAccount,
  normaliseTransaction,
  toPostingDate,
} from "./normalise";

// A minimal but valid Akahu transaction, spread over in each test so every
// case shows only what it's actually about.
const baseTransaction = {
  _id: "trans_test_1",
  _user: "user_test",
  _account: "acc_test_1",
  _connection: "conn_test_1",
  created_at: "2026-03-15T20:00:00.000Z",
  updated_at: "2026-03-15T20:00:00.000Z",
  date: "2026-03-15T00:00:00.000Z",
  hash: "hash_test_1",
  description: "COUNTDOWN WHANGAREI",
  amount: -85.4,
  type: "EFTPOS",
} as const;

describe("toPostingDate", () => {
  it("keeps the UTC calendar date", () => {
    expect(toPostingDate("2026-03-15T00:00:00.000Z").toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("strips the time, leaving a bare date at UTC midnight", () => {
    // Our column is a DATE. Anything with a time component would be an
    // implicit timezone decision made in the wrong layer.
    expect(toPostingDate("2026-03-15T13:45:12.345Z").toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("throws on an unparseable date", () => {
    expect(() => toPostingDate("not a date")).toThrow(TypeError);
  });
});

describe("normaliseTransaction", () => {
  it("converts amounts to integer cents", () => {
    const result = normaliseTransaction(baseTransaction as Transaction);
    expect(result.amountCents).toBe(-8540);
  });

  it("extracts merchant and category from an enriched transaction", () => {
    const result = normaliseTransaction({
      ...baseTransaction,
      merchant: { _id: "merchant_1", name: "Countdown" },
      category: {
        _id: "nzfcc_1",
        name: "Groceries",
        groups: {
          personal_finance: { _id: "group_1", name: "Household" },
        },
      },
    } as Transaction);

    expect(result.merchantName).toBe("Countdown");
    expect(result.akahuCategoryName).toBe("Groceries");
    expect(result.akahuCategoryGroup).toBe("Household");
  });

  it("imports an unenriched transaction with nulls rather than throwing", () => {
    // Akahu returns RawTransaction or EnrichedTransaction from the same
    // endpoint. A rent payment or a bank fee often has neither merchant nor
    // category, and must still import cleanly.
    const result = normaliseTransaction(baseTransaction as Transaction);

    expect(result.merchantName).toBeNull();
    expect(result.akahuCategoryName).toBeNull();
    expect(result.akahuCategoryGroup).toBeNull();
  });

  it("tolerates a category with no personal_finance grouping", () => {
    const result = normaliseTransaction({
      ...baseTransaction,
      merchant: { _id: "merchant_1", name: "Countdown" },
      category: { _id: "nzfcc_1", name: "Groceries", groups: {} },
    } as Transaction);

    expect(result.akahuCategoryName).toBe("Groceries");
    expect(result.akahuCategoryGroup).toBeNull();
  });

  it("keeps balance as cents, or null when the bank omitted it", () => {
    expect(
      normaliseTransaction({ ...baseTransaction, balance: 100 } as Transaction)
        .balanceAfterCents,
    ).toBe(10000);

    expect(
      normaliseTransaction(baseTransaction as Transaction).balanceAfterCents,
    ).toBeNull();
  });

  it("preserves the raw payload for Phase 2", () => {
    const input = { ...baseTransaction } as Transaction;
    expect(normaliseTransaction(input).raw).toBe(input);
  });

  it("uses Akahu's transaction id as the dedupe key", () => {
    expect(normaliseTransaction(baseTransaction as Transaction).externalId).toBe(
      "trans_test_1",
    );
  });
});

const baseAccount = {
  _id: "acc_test_1",
  _authorisation: "auth_test",
  _credentials: "deprecated",
  connection: { _id: "conn_test_1", name: "ANZ", logo: "" },
  name: "Everyday",
  status: "ACTIVE",
  type: "CHECKING",
  attributes: ["TRANSACTIONS"],
  balance: { currency: "NZD", current: 4820.55, available: 4700.0 },
} as const;

describe("normaliseAccount", () => {
  it("uses the current balance, not the available balance", () => {
    // `available` subtracts holds and pending authorisations. Reconciliation
    // compares against settled transactions only, so `current` is the one
    // that can actually balance.
    expect(normaliseAccount(baseAccount as Account).balanceCents).toBe(482055);
  });

  it("handles an account with no balance at all", () => {
    const { balance: _balance, ...withoutBalance } = baseAccount;
    const result = normaliseAccount(withoutBalance as Account);

    expect(result.balanceCents).toBeNull();
    expect(result.currency).toBe("NZD");
  });

  it("flags accounts with no transaction feed", () => {
    // Rewards and some investment accounts have a balance but no transactions.
    // Syncing them would fail every run and make a healthy sync look broken.
    expect(
      normaliseAccount({
        ...baseAccount,
        type: "REWARDS",
        attributes: [],
      } as unknown as Account).supportsTransactions,
    ).toBe(false);

    expect(normaliseAccount(baseAccount as Account).supportsTransactions).toBe(
      true,
    );
  });
});

describe("buildAccountName", () => {
  it("prefixes the bank so two 'Everyday' accounts don't collide", () => {
    expect(
      buildAccountName(normaliseAccount(baseAccount as Account)),
    ).toBe("ANZ Everyday");
  });

  it("falls back to the account name when there's no connection", () => {
    const account = normaliseAccount(baseAccount as Account);
    expect(buildAccountName({ ...account, connectionName: null })).toBe(
      "Everyday",
    );
  });
});

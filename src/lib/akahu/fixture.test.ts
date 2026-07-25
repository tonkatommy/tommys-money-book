import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "akahu";

import { FixtureAkahuGateway } from "./fixture";

// Three transactions on consecutive days, so the window boundaries are
// unambiguous.
const transactions = [
  { date: "2026-07-13T00:00:00.000Z", _id: "t1" },
  { date: "2026-07-14T00:00:00.000Z", _id: "t2" },
  { date: "2026-07-15T00:00:00.000Z", _id: "t3" },
].map((t) => ({
  ...t,
  _user: "user_test",
  _account: "acc_test_1",
  _connection: "conn_test_1",
  created_at: t.date,
  updated_at: t.date,
  hash: t._id,
  description: "TEST",
  amount: -10,
  type: "EFTPOS",
})) as unknown as Transaction[];

const gateway = new FixtureAkahuGateway({
  accounts: [] as Account[],
  transactions,
});

const ids = async (start?: string, end?: string) =>
  (
    await gateway.listTransactions("acc_test_1", {
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    })
  ).map((t) => t.externalId);

describe("FixtureAkahuGateway window semantics", () => {
  it("treats `start` as EXCLUSIVE, like the real API", async () => {
    // The boundary transaction is the one already at our high-water mark, so
    // excluding it is right — and matching Akahu exactly is what lets the
    // fixture catch an off-by-one that would otherwise only appear in
    // production against real data.
    expect(await ids("2026-07-13T00:00:00.000Z")).toEqual(["t2", "t3"]);
  });

  it("treats `end` as INCLUSIVE, like the real API", async () => {
    expect(await ids(undefined, "2026-07-14T00:00:00.000Z")).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("returns everything when unbounded", async () => {
    expect(await ids()).toEqual(["t1", "t2", "t3"]);
  });

  it("returns only the requested account", async () => {
    expect(await gateway.listTransactions("acc_other", {})).toEqual([]);
  });

  it("returns transactions in date order", async () => {
    const dates = (
      await gateway.listTransactions("acc_test_1", {})
    ).map((t) => t.date.getTime());

    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });
});

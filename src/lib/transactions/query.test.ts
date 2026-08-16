import { describe, expect, it } from "vitest";
import { utcDate } from "@/lib/budget/period";
import {
  currentMonth,
  filtersToQuery,
  parseDateParam,
  parseTransactionFilters,
} from "./query";

// These filters come from the URL, which is to say from anywhere: a bookmark, a
// hand-typed query string, a link from three months ago whose category has been
// deleted since. The parser's contract is that it is TOTAL — every input
// produces filters, none throws — so most of what is worth testing is the
// malformed cases.

const AUGUST = utcDate(2026, 7, 16); // 16 Aug 2026

describe("parseDateParam", () => {
  it("reads an ISO date as UTC midnight", () => {
    expect(parseDateParam("2026-08-16")).toEqual(utcDate(2026, 7, 16));
  });

  it("rejects a date that doesn't exist", () => {
    // `new Date("2026-02-31")` rolls forward into March. A filter that quietly
    // means a different day than the one written in the URL is worse than one
    // that is ignored.
    expect(parseDateParam("2026-02-31")).toBeNull();
    expect(parseDateParam("2026-13-01")).toBeNull();
  });

  it("rejects anything that isn't YYYY-MM-DD", () => {
    expect(parseDateParam("16/08/2026")).toBeNull();
    expect(parseDateParam("last tuesday")).toBeNull();
    expect(parseDateParam("")).toBeNull();
    expect(parseDateParam(undefined)).toBeNull();
  });
});

describe("currentMonth", () => {
  it("covers the whole month", () => {
    expect(currentMonth(AUGUST)).toEqual({
      from: utcDate(2026, 7, 1),
      to: utcDate(2026, 7, 31),
    });
  });

  it("gets February right without a leap-year branch", () => {
    expect(currentMonth(utcDate(2028, 1, 10)).to).toEqual(utcDate(2028, 1, 29));
    expect(currentMonth(utcDate(2026, 1, 10)).to).toEqual(utcDate(2026, 1, 28));
  });
});

describe("parseTransactionFilters", () => {
  it("defaults to the current month and the personal book", () => {
    const filters = parseTransactionFilters({}, AUGUST);

    expect(filters.book).toBe("PERSONAL");
    expect(filters.from).toEqual(utcDate(2026, 7, 1));
    expect(filters.to).toEqual(utcDate(2026, 7, 31));
    expect(filters.page).toBe(1);
    expect(filters.q).toBe("");
    expect(filters.uncategorised).toBe(false);
    expect(filters.accountId).toBeNull();
    expect(filters.categoryId).toBeNull();
  });

  it("reads each filter", () => {
    const filters = parseTransactionFilters(
      {
        book: "BUSINESS",
        account: "acc_1",
        category: "cat_1",
        q: "  mitre  ",
        from: "2026-07-01",
        to: "2026-07-31",
        page: "3",
      },
      AUGUST,
    );

    expect(filters.book).toBe("BUSINESS");
    expect(filters.accountId).toBe("acc_1");
    expect(filters.categoryId).toBe("cat_1");
    expect(filters.q).toBe("mitre");
    expect(filters.from).toEqual(utcDate(2026, 6, 1));
    expect(filters.page).toBe(3);
  });

  it("lets 'uncategorised' win over a category id", () => {
    // Both together describe an empty set, and answering a contradictory URL
    // with zero rows looks like a bug in the data rather than in the URL.
    const filters = parseTransactionFilters(
      { uncategorised: "1", category: "cat_1" },
      AUGUST,
    );

    expect(filters.uncategorised).toBe(true);
    expect(filters.categoryId).toBeNull();
  });

  it("swaps a backwards date range rather than rejecting it", () => {
    const filters = parseTransactionFilters(
      { from: "2026-08-31", to: "2026-08-01" },
      AUGUST,
    );

    expect(filters.from).toEqual(utcDate(2026, 7, 1));
    expect(filters.to).toEqual(utcDate(2026, 7, 31));
  });

  it("falls back rather than throwing on malformed input", () => {
    const filters = parseTransactionFilters(
      { page: "banana", from: "not-a-date", book: "SIDEWAYS" },
      AUGUST,
    );

    expect(filters.page).toBe(1);
    expect(filters.from).toEqual(utcDate(2026, 7, 1));
    expect(filters.book).toBe("PERSONAL");
  });

  it("rejects a zero or negative page", () => {
    // Page 0 would produce a negative `skip`, which Prisma refuses.
    expect(parseTransactionFilters({ page: "0" }, AUGUST).page).toBe(1);
    expect(parseTransactionFilters({ page: "-2" }, AUGUST).page).toBe(1);
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseTransactionFilters({ q: ["one", "two"] }, AUGUST).q).toBe("one");
  });
});

describe("filtersToQuery", () => {
  const base = parseTransactionFilters({}, AUGUST);

  it("keeps the URL short by omitting defaults", () => {
    const query = filtersToQuery(base);

    expect(query).not.toContain("book=");
    expect(query).not.toContain("page=");
    expect(query).toContain("from=2026-08-01");
    expect(query).toContain("to=2026-08-31");
  });

  it("round-trips through the parser", () => {
    const filters = parseTransactionFilters(
      { book: "BUSINESS", account: "acc_1", q: "mitre", page: "4", uncategorised: "1" },
      AUGUST,
    );
    const round = parseTransactionFilters(
      Object.fromEntries(new URLSearchParams(filtersToQuery(filters))),
      AUGUST,
    );

    expect(round).toEqual(filters);
  });

  it("applies overrides, which is what pagination links are", () => {
    expect(filtersToQuery(base, { page: 2 })).toContain("page=2");
  });

  it("omits the dates when they came from the period, not the reader", () => {
    // The bug this pins: a pagination link that spells out the period's dates
    // makes the NEXT request see ?from/?to and conclude the reader chose a
    // custom range — which hides the budget annotation and shows the custom
    // range notice, just from clicking Next. Absence is what means "period".
    const query = filtersToQuery(base, { page: 2 }, { omitDates: true });

    expect(query).not.toContain("from=");
    expect(query).not.toContain("to=");
    expect(query).toContain("page=2");
  });

  it("carries the period through, so a link doesn't jump you to the current one", () => {
    const query = filtersToQuery(base, { page: 2 }, {
      omitDates: true,
      period: "2026-06-20",
    });

    expect(query).toContain("period=2026-06-20");
  });

  it("still emits dates for a genuinely custom range", () => {
    const custom = parseTransactionFilters(
      { from: "2025-07-01", to: "2025-07-31" },
      AUGUST,
    );

    expect(filtersToQuery(custom)).toContain("from=2025-07-01");
    expect(filtersToQuery(custom)).toContain("to=2025-07-31");
  });
});

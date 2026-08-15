import { describe, expect, it } from "vitest";
import { detectRecurring, type RecurringInput } from "./recurring";
import { utcDate } from "./period";

function txn(
  date: Date,
  amountCents: number,
  description: string,
  categoryId = "insurance",
): RecurringInput {
  return { categoryId, date, description, amountCents };
}

describe("detectRecurring", () => {
  it("finds a monthly bill billed on roughly the same day", () => {
    const suggestions = detectRecurring([
      txn(utcDate(2026, 4, 28), 14_260, "State Insura 4155 Lans"),
      txn(utcDate(2026, 5, 28), 14_260, "State Insura 4155 Lans"),
      txn(utcDate(2026, 6, 28), 14_260, "State Insura 4155 Lans"),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      categoryId: "insurance",
      dueDay: 28,
      amountCents: 14_260,
      estimated: false,
      occurrences: 3,
    });
  });

  it("groups a bill whose reference changes every month", () => {
    // The reason this reuses normaliseDescription: the trailing reference
    // makes every row unique, so without normalising these are three
    // unrelated payments rather than one bill.
    const suggestions = detectRecurring([
      txn(utcDate(2026, 4, 1), 8_900, "Spark Nz Trading 884213"),
      txn(utcDate(2026, 5, 1), 8_900, "Spark Nz Trading 884977"),
      txn(utcDate(2026, 6, 1), 8_900, "Spark Nz Trading 885401"),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].occurrences).toBe(3);
  });

  it("flags a bill whose amount moves as an estimate", () => {
    // Power. Budgeting $158 as a hard figure would read as an overspend every
    // winter month.
    const suggestions = detectRecurring([
      txn(utcDate(2026, 4, 17), 14_200, "Contact Energy", "power"),
      txn(utcDate(2026, 5, 17), 16_800, "Contact Energy", "power"),
      txn(utcDate(2026, 6, 17), 18_900, "Contact Energy", "power"),
    ]);

    expect(suggestions[0]).toMatchObject({ estimated: true, dueDay: 17 });
    // The most recent amount, not the average — it is the best guess at next
    // month.
    expect(suggestions[0].amountCents).toBe(18_900);
  });

  it("does not flag everyday spending", () => {
    // Groceries: same category, same shop, but several times a month.
    const suggestions = detectRecurring([
      txn(utcDate(2026, 6, 22), 15_915, "Woolworths Helensville", "groceries"),
      txn(utcDate(2026, 6, 31), 11_860, "Woolworths Helensville", "groceries"),
      txn(utcDate(2026, 7, 8), 10_375, "Woolworths Helensville", "groceries"),
      txn(utcDate(2026, 7, 15), 8_732, "Woolworths Helensville", "groceries"),
    ]);

    expect(suggestions).toEqual([]);
  });

  it("does not flag two payments as a habit", () => {
    const suggestions = detectRecurring([
      txn(utcDate(2026, 5, 28), 14_260, "State Insura 4155 Lans"),
      txn(utcDate(2026, 6, 28), 14_260, "State Insura 4155 Lans"),
    ]);

    expect(suggestions).toEqual([]);
  });

  it("rejects a run whose gaps are not monthly", () => {
    // Three purchases spread across a quarter average out to a monthly gap,
    // which is why every individual gap has to qualify, not the mean.
    const suggestions = detectRecurring([
      txn(utcDate(2026, 4, 2), 9_000, "Gamers Outle", "leisure"),
      txn(utcDate(2026, 4, 9), 9_000, "Gamers Outle", "leisure"),
      txn(utcDate(2026, 6, 20), 9_000, "Gamers Outle", "leisure"),
    ]);

    expect(suggestions).toEqual([]);
  });

  it("tolerates a short February and a payment sliding off a weekend", () => {
    const suggestions = detectRecurring([
      txn(utcDate(2027, 0, 31), 11_200, "Afterpay", "bnpl"),
      txn(utcDate(2027, 1, 28), 11_200, "Afterpay", "bnpl"),
      txn(utcDate(2027, 2, 30), 11_200, "Afterpay", "bnpl"),
    ]);

    expect(suggestions).toHaveLength(1);
  });

  it("ignores refunds and other money coming back", () => {
    const suggestions = detectRecurring([
      txn(utcDate(2026, 4, 28), -14_260, "State Insura 4155 Lans"),
      txn(utcDate(2026, 5, 28), -14_260, "State Insura 4155 Lans"),
      txn(utcDate(2026, 6, 28), -14_260, "State Insura 4155 Lans"),
    ]);

    expect(suggestions).toEqual([]);
  });

  it("keeps the longest run when a category holds more than one", () => {
    const suggestions = detectRecurring([
      txn(utcDate(2026, 3, 2), 7_800, "Paypal *Shopifycomm", "software"),
      txn(utcDate(2026, 4, 2), 7_800, "Paypal *Shopifycomm", "software"),
      txn(utcDate(2026, 5, 2), 7_800, "Paypal *Shopifycomm", "software"),
      txn(utcDate(2026, 6, 2), 7_800, "Paypal *Shopifycomm", "software"),
      txn(utcDate(2026, 4, 11), 2_400, "Akiflow", "software"),
      txn(utcDate(2026, 5, 11), 2_400, "Akiflow", "software"),
      txn(utcDate(2026, 6, 11), 2_400, "Akiflow", "software"),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ occurrences: 4, amountCents: 7_800 });
  });

  it("returns one suggestion per category, biggest first", () => {
    const suggestions = detectRecurring([
      txn(utcDate(2026, 4, 3), 185_000, "Asb Home Loan", "mortgage"),
      txn(utcDate(2026, 5, 3), 185_000, "Asb Home Loan", "mortgage"),
      txn(utcDate(2026, 6, 3), 185_000, "Asb Home Loan", "mortgage"),
      txn(utcDate(2026, 4, 11), 2_400, "Akiflow", "software"),
      txn(utcDate(2026, 5, 11), 2_400, "Akiflow", "software"),
      txn(utcDate(2026, 6, 11), 2_400, "Akiflow", "software"),
    ]);

    expect(suggestions.map((s) => s.categoryId)).toEqual([
      "mortgage",
      "software",
    ]);
  });
});

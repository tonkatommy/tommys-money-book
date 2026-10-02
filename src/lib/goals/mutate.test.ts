// The goal form's parsing. The account checks and the one-active-goal rule
// need Postgres and are verified by hand (Phase 4c spec §8); what is
// unit-testable is where typed text becomes a target and a date, the one
// rule that differs between create and edit, and the confirmation that stands
// between a stray POST and a permanent delete.

import { describe, expect, it } from "vitest";
import { utcDate } from "@/lib/budget/period";
import {
  DELETE_CONFIRMATION,
  GOAL_NAME_MAX,
  isDeleteConfirmed,
  parseGoalForm,
} from "./mutate";

const TODAY = utcDate(2026, 9, 2);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  const defaults = { name: "Japan", accountId: "acc_1", target: "5000", targetDate: "", note: "" };
  for (const [key, value] of Object.entries({ ...defaults, ...fields })) data.set(key, value);
  return data;
}

describe("parseGoalForm", () => {
  it("parses a complete goal", () => {
    const result = parseGoalForm(
      form({ target: "$5,000.50", targetDate: "2027-06-30", note: "  flights  " }),
      TODAY,
      "create",
    );
    expect(result).toEqual({
      ok: true,
      goal: {
        name: "Japan",
        accountId: "acc_1",
        targetCents: 500_050,
        targetDate: utcDate(2027, 5, 30),
        note: "flights",
      },
    });
  });

  it("treats a blank date and note as none", () => {
    const result = parseGoalForm(form({}), TODAY, "create");
    expect(result.ok && result.goal.targetDate).toBeNull();
    expect(result.ok && result.goal.note).toBeNull();
  });

  it("refuses a blank or overlong name", () => {
    expect(parseGoalForm(form({ name: "   " }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ name: "x".repeat(GOAL_NAME_MAX + 1) }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ name: "x".repeat(GOAL_NAME_MAX) }), TODAY, "create").ok).toBe(true);
  });

  it("refuses a missing account", () => {
    expect(parseGoalForm(form({ accountId: "" }), TODAY, "create").ok).toBe(false);
  });

  it("refuses a zero, negative or unparseable target", () => {
    expect(parseGoalForm(form({ target: "0" }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ target: "-50" }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ target: "lots" }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ target: "" }), TODAY, "create").ok).toBe(false);
  });

  it("refuses a date that doesn't exist rather than rolling it into March", () => {
    expect(parseGoalForm(form({ targetDate: "2027-02-31" }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ targetDate: "30/06/2027" }), TODAY, "create").ok).toBe(false);
  });

  it("refuses a date on or before today on create", () => {
    expect(parseGoalForm(form({ targetDate: "2026-10-02" }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ targetDate: "2026-09-01" }), TODAY, "create").ok).toBe(false);
    expect(parseGoalForm(form({ targetDate: "2026-10-03" }), TODAY, "create").ok).toBe(true);
  });

  it("allows a past date on edit, so a missed goal can be kept and re-dated", () => {
    expect(parseGoalForm(form({ targetDate: "2026-09-01" }), TODAY, "edit").ok).toBe(true);
  });

  it("takes create or edit from its caller, not from anything the form claims", () => {
    // A direct POST can add any field it likes. Only the `mode` argument the
    // action passes decides whether a past date is allowed.
    const posted = form({ targetDate: "2026-09-01", mode: "edit" });
    expect(parseGoalForm(posted, TODAY, "create").ok).toBe(false);
  });
});

describe("isDeleteConfirmed", () => {
  function confirm(value?: string): FormData {
    const data = new FormData();
    data.set("id", "goal_1");
    if (value !== undefined) data.set("confirm", value);
    return data;
  }

  it("is yes only for the exact confirmation value", () => {
    expect(isDeleteConfirmed(confirm(DELETE_CONFIRMATION))).toBe(true);
  });

  it("is no when the box was left unticked, which posts nothing", () => {
    expect(isDeleteConfirmed(confirm())).toBe(false);
  });

  it("is no for anything else a crafted POST might send", () => {
    for (const value of ["", "on", "true", "yes", "DELETE", " delete"]) {
      expect(isDeleteConfirmed(confirm(value))).toBe(false);
    }
  });
});

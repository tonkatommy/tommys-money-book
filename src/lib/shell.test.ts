// The header dot is the only sync signal visible from every screen, so the
// failure guarded here is a green dot over a feed that has stopped.

import { describe, expect, it } from "vitest";
import { syncHealth } from "./shell";

const now = new Date("2026-11-03T08:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("syncHealth", () => {
  it("is ok after this morning's successful run", () => {
    expect(
      syncHealth({ lastSuccess: hoursAgo(2), latestFinishedStatus: "SUCCESS", now }),
    ).toBe("ok");
  });

  it("is overdue once a morning is missed, even though nothing failed", () => {
    expect(
      syncHealth({ lastSuccess: hoursAgo(40), latestFinishedStatus: "SUCCESS", now }),
    ).toBe("overdue");
  });

  it("is overdue when there has never been a successful run", () => {
    expect(syncHealth({ lastSuccess: null, latestFinishedStatus: null, now })).toBe(
      "overdue",
    );
  });

  it("is failing when the latest finished run failed, even with a recent success", () => {
    expect(
      syncHealth({ lastSuccess: hoursAgo(3), latestFinishedStatus: "FAILED", now }),
    ).toBe("failing");
  });

  it("prefers failing over overdue", () => {
    expect(
      syncHealth({ lastSuccess: hoursAgo(80), latestFinishedStatus: "FAILED", now }),
    ).toBe("failing");
  });

  it("does not count a partial run as a failure", () => {
    expect(
      syncHealth({ lastSuccess: hoursAgo(2), latestFinishedStatus: "PARTIAL", now }),
    ).toBe("ok");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkPassword, signSession, verifySession } from "./session";

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "correct-horse-battery-staple");
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkPassword", () => {
  it("accepts the configured password", () => {
    expect(checkPassword("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects a wrong password, including one of different length", () => {
    expect(checkPassword("wrong")).toBe(false);
    expect(checkPassword("correct-horse-battery-staple-but-longer")).toBe(
      false,
    );
    expect(checkPassword("")).toBe(false);
  });
});

describe("signSession / verifySession", () => {
  it("accepts a value it just signed", () => {
    expect(verifySession(signSession())).toBe(true);
  });

  it("rejects a tampered HMAC", () => {
    const signed = signSession();
    const [issuedAt, hmac] = signed.split(".");
    const flippedChar = hmac![0] === "a" ? "b" : "a";
    const tampered = `${issuedAt}.${flippedChar}${hmac!.slice(1)}`;

    expect(verifySession(tampered)).toBe(false);
  });

  it("rejects a session older than 30 days", () => {
    const issuedAt = Date.now() - 31 * DAY_MS;
    expect(verifySession(signSession(issuedAt))).toBe(false);
  });

  it("accepts a session right at the edge of 30 days", () => {
    const issuedAt = Date.now() - 29 * DAY_MS;
    expect(verifySession(signSession(issuedAt))).toBe(true);
  });

  it("rejects malformed input without throwing", () => {
    expect(verifySession(undefined)).toBe(false);
    expect(verifySession("")).toBe(false);
    expect(verifySession("garbage")).toBe(false);
    expect(verifySession("not-a-number.deadbeef")).toBe(false);
    expect(verifySession(".")).toBe(false);
  });
});

// Two failures this guards against: an open redirect off the app after login,
// and a redirect to the redirect-only root, which breaks the JS login flow
// (see the header in next-path.ts).

import { describe, expect, it } from "vitest";

import { HOME_PATH, sanitizeNextPath } from "./next-path";

describe("sanitizeNextPath", () => {
  it("keeps a same-origin path, query included", () => {
    expect(sanitizeNextPath("/transactions?book=BUSINESS")).toBe(
      "/transactions?book=BUSINESS",
    );
  });

  it.each([undefined, null, ""])("falls back to home for %p", (value) => {
    expect(sanitizeNextPath(value)).toBe(HOME_PATH);
  });

  it.each([
    "https://evil.example",
    "evil.example",
    "//evil.example",
    "/\\evil.example",
  ])("refuses the off-site target %s", (value) => {
    expect(sanitizeNextPath(value)).toBe(HOME_PATH);
  });

  it.each(["/", "/?book=BUSINESS", "/#top"])(
    "sends the redirect-only root %s straight to home",
    (value) => {
      expect(sanitizeNextPath(value)).toBe(HOME_PATH);
    },
  );

  it("does not mistake a real path that starts with a slash for the root", () => {
    expect(sanitizeNextPath("/budget/history")).toBe("/budget/history");
  });
});

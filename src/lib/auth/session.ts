// Password check and session cookie signing for Phase 3a's single shared
// login (design spec §2).
//
// No session table — this is a stateless, self-verifying cookie:
// `${issuedAt}.${hmac}`, where hmac = HMAC-SHA256(issuedAt, SESSION_SECRET).
// Verifying just means recomputing the HMAC and checking the age, so it
// costs nothing beyond the request that carries it.
//
// This Next.js version (16.2.10) runs Proxy on the Node.js runtime by
// default (the "middleware must use Web Crypto because it's Edge-only" rule
// from older Next versions no longer applies — see proxy.ts), so this module
// uses node:crypto directly rather than Web Crypto, matching the rest of the
// codebase's Node-only scripts.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "@/lib/secrets";

export const SESSION_COOKIE_NAME = "session";

export const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Constant-time string comparison that tolerates different-length inputs.
 *
 * `crypto.timingSafeEqual` throws if the two buffers aren't the same length,
 * and a submitted password is essentially never the same length as the real
 * one — so the raw strings are hashed to a fixed-length digest first. The
 * digest comparison is still timing-safe; only the (irrelevant) length of
 * the guess leaks, which `===` would leak anyway via early exit.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

/** Compare a submitted password against APP_PASSWORD without leaking timing. */
export function checkPassword(submitted: string): boolean {
  return timingSafeStringEqual(submitted, requireSecret("APP_PASSWORD"));
}

function hmacFor(issuedAt: string): string {
  return createHmac("sha256", requireSecret("SESSION_SECRET"))
    .update(issuedAt)
    .digest("hex");
}

/** Sign a new session cookie value. */
export function signSession(issuedAt: number = Date.now()): string {
  const issuedAtStr = String(issuedAt);
  return `${issuedAtStr}.${hmacFor(issuedAtStr)}`;
}

/** True if `cookieValue` is a session this server signed, not yet expired. */
export function verifySession(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;

  const separatorIndex = cookieValue.indexOf(".");
  if (separatorIndex === -1) return false;

  const issuedAtStr = cookieValue.slice(0, separatorIndex);
  const hmac = cookieValue.slice(separatorIndex + 1);

  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt) || issuedAtStr === "") return false;

  if (!timingSafeStringEqual(hmac, hmacFor(issuedAtStr))) return false;

  return Date.now() - issuedAt <= MAX_SESSION_AGE_MS;
}

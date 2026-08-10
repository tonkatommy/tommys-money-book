"use server";

// The only Server Action that runs before a session exists.
//
// Errors are returned, not thrown (design spec §6) — the form re-renders
// with an inline message instead of crashing to Next's error page. A raw
// config/database error is logged server-side and replaced with a generic
// message in production, the same split src/app/page.tsx already uses.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sanitizeNextPath } from "@/lib/auth/next-path";
import {
  MAX_SESSION_AGE_MS,
  SESSION_COOKIE_NAME,
  checkPassword,
  signSession,
} from "@/lib/auth/session";

export type LoginState = { ok: false; error: string } | undefined;

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNextPath(formData.get("next")?.toString());

  try {
    if (!checkPassword(password)) {
      return { ok: false, error: "Incorrect password." };
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, signSession(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_SESSION_AGE_MS / 1000,
    });
  } catch (err) {
    console.error("Login failed", err);
    return {
      ok: false,
      error:
        process.env.NODE_ENV === "production"
          ? "Login is unavailable. Check server logs."
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }

  redirect(next);
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

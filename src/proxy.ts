// Gate for every page except /login (design spec §2).
//
// Named `proxy.ts`, not `middleware.ts` — this Next.js version renamed the
// file convention (node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/proxy.md). It also runs on the Node.js runtime by
// default as of Next 16, which is what lets session.ts use node:crypto here
// directly instead of Web Crypto.
//
// No lockout or rate-limiting on login attempts, deliberately: single user,
// LAN-only.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Must be checked here rather than only via the matcher, or a failed
  // session check on /login itself would redirect to /login and loop.
  if (pathname === "/login") return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (verifySession(cookie)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except static assets. Server Actions are POSTs to the page
  // route they're declared on, so they're covered by default rather than
  // needing a separate matcher entry.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

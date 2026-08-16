// Re-checking the session inside anything that writes.
//
// `src/proxy.ts` already gates every route except /login, and a Server Action
// is a POST to the route it's declared on, so it is covered. This is a second
// check on top of that, for one reason the Next.js docs state plainly:
//
//   "Server Functions are reachable via direct POST requests, not just
//    through your application's UI. Always verify authentication and
//    authorization inside every Server Function."
//   (node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md)
//
// The proxy matcher is one regex away from accidentally excluding a path, and
// the failure mode is silent: everything keeps working, and an unauthenticated
// POST can rewrite the budget. Two independent checks means a mistake in
// either one is not enough on its own.

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "./session";

/** True if the request carries a session this server signed. */
export async function hasSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

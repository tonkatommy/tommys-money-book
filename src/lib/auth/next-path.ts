// The open-redirect guard for `?next=` params.
//
// A `next` value the app didn't generate itself (a bookmarked link, a typed
// URL) must never send a logged-in user off this app. "Starts with /" isn't
// enough on its own — "//evil.example" and "/\evil.example" both parse as
// same-origin-looking strings but browsers resolve them to a different host.
//
// It also never returns "/" itself. `/` only exists to redirect to /budget
// (src/app/page.tsx), and the login Server Action must not redirect to a page
// that redirects again. With JavaScript on, Next follows an action's redirect
// by fetching the target internally and streaming it back; when that target
// redirects too, a `Location` header leaks onto the action response, the
// browser's fetch follows it to plain HTML, and the client router throws "An
// unexpected response was received from the server". Login succeeded, but
// the screen said otherwise. Going straight to the real page avoids the hop.

/** The screen `/` redirects to, and where login lands by default. */
export const HOME_PATH = "/budget";

/** Returns a safe same-origin path to redirect to after login, defaulting to HOME_PATH. */
export function sanitizeNextPath(value: string | null | undefined): string {
  if (!value) return HOME_PATH;
  if (!value.startsWith("/")) return HOME_PATH;
  if (value.startsWith("//")) return HOME_PATH;
  if (value.includes("\\")) return HOME_PATH;
  // "/", "/?…" and "/#…" all land on the redirect-only root.
  if (/^\/(?:[?#]|$)/.test(value)) return HOME_PATH;
  return value;
}

// The open-redirect guard for `?next=` params.
//
// A `next` value the app didn't generate itself (a bookmarked link, a typed
// URL) must never send a logged-in user off this app. "Starts with /" isn't
// enough on its own — "//evil.example" and "/\evil.example" both parse as
// same-origin-looking strings but browsers resolve them to a different host.

/** Returns a safe same-origin path to redirect to after login, defaulting to "/". */
export function sanitizeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

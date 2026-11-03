// The only route proxy.ts lets through unauthenticated (design spec §2).
//
// Layout follows the Money Book canvas (Login.dc.html). It says nothing
// about the data — no "last synced" line — because nothing on this page may
// read the database before the visitor has signed in.

import { sanitizeNextPath } from "@/lib/auth/next-path";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <main className="stack" style={{ width: "100%", maxWidth: 400, gap: 28 }}>
        <div className="stack" style={{ gap: 14, alignItems: "flex-start" }}>
          <span className="logo" style={{ fontSize: 24 }}>
            <span className="mk" style={{ width: 44, height: 44 }} aria-hidden="true" />
            Money Book
          </span>
          <p className="t-b ink2">Your two books, kept separately.</p>
        </div>
        <LoginForm next={next} />
        <p className="t-xs ink3">
          Self-hosted · single user · forgotten it? It&apos;s APP_PASSWORD in the
          server environment.
        </p>
      </main>
    </div>
  );
}

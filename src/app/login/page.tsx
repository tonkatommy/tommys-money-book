// The only route proxy.ts lets through unauthenticated (design spec §2).

import { sanitizeNextPath } from "@/lib/auth/next-path";
import { Card } from "@/components/ui/primitives";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ marginBottom: "var(--space-6)" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--text-xl)",
              fontWeight: "var(--weight-bold)",
              letterSpacing: "var(--tracking-tight)",
              color: "var(--text-primary)",
            }}
          >
            Tommy&rsquo;s Money Book
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "var(--text-sm)",
              color: "var(--text-tertiary)",
            }}
          >
            Homelab · one password, one user.
          </p>
        </div>

        <Card>
          <LoginForm next={next} />
        </Card>
      </div>
    </main>
  );
}

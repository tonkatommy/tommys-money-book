// The only route proxy.ts lets through unauthenticated (design spec §2).

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
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
        <h1 className="text-lg font-semibold text-zinc-100">
          Tommy&apos;s Money Book
        </h1>
        <p className="mt-1 text-sm text-zinc-400">Sign in to continue.</p>

        <div className="mt-6">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}

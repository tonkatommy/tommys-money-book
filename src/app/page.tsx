// Phase 0 deliverable: a page that reads from Postgres.
// This is a React Server Component — the default in the App Router — so the
// database query runs on the server and only HTML is sent to the browser.
// No API route needed for a read like this.

import { prisma } from "@/lib/prisma";

// Without this, Next.js would run the query once at build time and bake the
// result into static HTML. We want it to run on every request so the page
// always reflects the live database.
export const dynamic = "force-dynamic";

type DbStatus =
  | {
      ok: true;
      version: string;
      now: string;
      counts: { accounts: number; categories: number; transactions: number };
    }
  | { ok: false; error: string };

async function getDbStatus(): Promise<DbStatus> {
  try {
    // $queryRaw is Prisma's escape hatch for raw SQL — used here because
    // version() and NOW() aren't model queries. It's a tagged template, so
    // any interpolated values would be parameterised (no SQL injection).
    const [info] = await prisma.$queryRaw<
      { version: string; now: Date }[]
    >`SELECT version() AS version, NOW() AS now`;

    const [accounts, categories, transactions] = await Promise.all([
      prisma.account.count(),
      prisma.category.count(),
      prisma.transaction.count(),
    ]);

    return {
      ok: true,
      version: info.version.split(" on ")[0], // trim the build details
      now: info.now.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" }),
      counts: { accounts, categories, transactions },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (process.env.NODE_ENV === "production") {
      console.error("Database status check failed", err);
      return { ok: false, error: "Database unreachable. Check server logs." };
    }

    return { ok: false, error: message };
  }
}

export default async function Home() {
  const status = await getDbStatus();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-8">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-zinc-100">
          Tommy&apos;s Money Book
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Phase 0 — hello, database
        </p>

        {status.ok ? (
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="text-emerald-400">Connected</span>
            </div>
            <Row label="Database" value={status.version} />
            <Row label="Server time (NZ)" value={status.now} />
            <Row label="Accounts" value={String(status.counts.accounts)} />
            <Row label="Categories" value={String(status.counts.categories)} />
            <Row
              label="Transactions"
              value={String(status.counts.transactions)}
            />
          </dl>
        ) : (
          <div className="mt-6 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-red-400">Database unreachable</span>
            </div>
            <p className="rounded-md bg-zinc-800 p-3 font-mono text-xs text-zinc-300">
              {status.error}
            </p>
            <p className="text-zinc-400">
              Is Postgres running? Try{" "}
              <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">
                docker compose up -d db
              </code>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-t border-zinc-800 pt-3">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="text-right font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

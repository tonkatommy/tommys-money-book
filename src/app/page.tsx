// Phase 1 deliverable: the sync status page.
//
// The plan is explicit that Phase 1 gets "no UI beyond a bare sync-status
// page" — transaction lists and dashboards are Phase 3. What this page must do
// is answer one question at a glance: is the database still filling itself?
//
// A React Server Component, so the queries run on the server and only HTML
// reaches the browser. No API route needed for a read.

import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { getSyncStatus, type SyncStatusView } from "@/lib/sync/status";
import { logout } from "@/app/login/actions";

// Without this, Next.js would run the queries once at build time and bake the
// result into static HTML. Sync status is only useful if it's live.
export const dynamic = "force-dynamic";

type PageData =
  | { ok: true; status: SyncStatusView; dbVersion: string; now: string }
  | { ok: false; error: string };

async function load(): Promise<PageData> {
  try {
    const [info] = await prisma.$queryRaw<
      { version: string; now: Date }[]
    >`SELECT version() AS version, NOW() AS now`;

    return {
      ok: true,
      status: await getSyncStatus(),
      dbVersion: info.version.split(" on ")[0],
      now: info.now.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // In production a database error message can name the host and user, so
    // it goes to the logs rather than the page.
    if (process.env.NODE_ENV === "production") {
      console.error("Status page query failed", err);
      return { ok: false, error: "Database unreachable. Check server logs." };
    }
    return { ok: false, error: message };
  }
}

export default async function Home() {
  const data = await load();

  return (
    <main className="min-h-screen bg-zinc-950 p-6 sm:p-10">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">
              Tommy&apos;s Money Book
            </h1>
            <p className="mt-1 text-sm text-zinc-400">Sync status</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Log out
            </button>
          </form>
        </header>

        {!data.ok ? (
          <Card>
            <StatusDot tone="error" label="Database unreachable" />
            <p className="mt-3 rounded-md bg-zinc-800 p-3 font-mono text-xs text-zinc-300">
              {data.error}
            </p>
            <p className="mt-3 text-sm text-zinc-400">
              Is Postgres running? Try{" "}
              <Code>docker compose up -d db</Code>
            </p>
          </Card>
        ) : (
          <>
            {data.status.alerts.length > 0 && (
              <div className="space-y-2">
                {data.status.alerts.map((alert, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border p-4 text-sm ${
                      alert.level === "error"
                        ? "border-red-900 bg-red-950/50 text-red-200"
                        : "border-amber-900 bg-amber-950/40 text-amber-200"
                    }`}
                  >
                    {alert.message}
                  </div>
                ))}
              </div>
            )}

            <Accounts accounts={data.status.accounts} />
            <Runs runs={data.status.runs} />

            <Card>
              <h2 className="text-sm font-medium text-zinc-300">Database</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Version" value={data.dbVersion} />
                <Row label="Server time (NZ)" value={data.now} />
              </dl>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

function Accounts({
  accounts,
}: {
  accounts: SyncStatusView["accounts"];
}) {
  if (accounts.length === 0) {
    return (
      <Card>
        <h2 className="text-sm font-medium text-zinc-300">Accounts</h2>
        <p className="mt-3 text-sm text-zinc-400">
          No accounts yet. Run <Code>npm run sync:baseline</Code> to pull them
          from Akahu.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-sm font-medium text-zinc-300">Accounts</h2>
      <div className="mt-4 space-y-4">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-zinc-100">{account.name}</span>
              <span className="font-mono text-sm text-zinc-200">
                {account.balanceCents !== null
                  ? formatNZD(account.balanceCents)
                  : "—"}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {account.book ? (
                <Badge tone="neutral">{account.book}</Badge>
              ) : (
                <Badge tone="warning">needs mapping</Badge>
              )}

              {account.akahuStatus === "INACTIVE" && (
                <Badge tone="error">needs re-consent</Badge>
              )}

              {account.driftCents !== null && account.driftCents !== 0 && (
                <Badge tone={account.driftIsPersistent ? "error" : "warning"}>
                  drift {formatNZD(account.driftCents)}
                </Badge>
              )}

              {account.driftCents === 0 && <Badge tone="ok">balanced</Badge>}

              {/* Neutral, not a warning. Pending authorisations are normal on
                  a card account and reconciliation already accounts for them —
                  but showing the figure explains why the bank's balance is
                  lower than the transactions that have actually cleared. */}
              {account.pendingTotalCents !== 0 && (
                <Badge tone="neutral">
                  {formatNZD(account.pendingTotalCents)} pending
                </Badge>
              )}
            </div>

            <dl className="mt-3 space-y-2 text-sm">
              <Row
                label="Transactions"
                value={String(account.transactionCount)}
              />
              <Row
                label="History from"
                value={formatDate(account.historyStartDate)}
              />
              <Row
                label="Latest transaction"
                value={formatDate(account.lastTransactionAt)}
              />
              <Row
                label="Last synced"
                value={formatDateTime(account.lastSyncedAt)}
              />
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Runs({ runs }: { runs: SyncStatusView["runs"] }) {
  return (
    <Card>
      <h2 className="text-sm font-medium text-zinc-300">Recent sync runs</h2>

      {runs.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">
          Nothing yet. Run <Code>npm run sync:baseline</Code>.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="pb-2 pr-4 font-medium">Started</th>
                <th className="pb-2 pr-4 font-medium">Trigger</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 text-right font-medium">New</th>
                {/* Duplicates are shown on purpose: a healthy daily sync
                    always has some, because the window deliberately re-reads
                    a week. Zero duplicates would mean the overlap is gone. */}
                <th className="pb-2 pr-4 text-right font-medium">Already held</th>
                <th className="pb-2 text-right font-medium">Took</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-zinc-800">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatDateTime(run.startedAt)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{run.trigger}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={runTone(run.status)}>{run.status}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono">
                    {run.inserted}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-zinc-500">
                    {run.duplicates}
                  </td>
                  <td className="py-2 text-right font-mono text-zinc-500">
                    {run.durationMs !== null
                      ? `${(run.durationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type Tone = "ok" | "warning" | "error" | "neutral";

function runTone(status: string): Tone {
  if (status === "SUCCESS") return "ok";
  if (status === "FAILED") return "error";
  if (status === "PARTIAL") return "warning";
  return "neutral";
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-t border-zinc-800 pt-2">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="text-right font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const tones: Record<Tone, string> = {
    ok: "border-emerald-900 bg-emerald-950/60 text-emerald-300",
    warning: "border-amber-900 bg-amber-950/60 text-amber-300",
    error: "border-red-900 bg-red-950/60 text-red-300",
    neutral: "border-zinc-700 bg-zinc-800 text-zinc-300",
  };

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  const dots: Record<Tone, string> = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    neutral: "bg-zinc-500",
  };
  const text: Record<Tone, string> = {
    ok: "text-emerald-400",
    warning: "text-amber-400",
    error: "text-red-400",
    neutral: "text-zinc-400",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${dots[tone]}`} />
      <span className={`text-sm ${text[tone]}`}>{label}</span>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

// Dates are stored as bare DATEs at UTC midnight, so they're formatted in UTC.
// Using NZ time here would display 2026-07-20 as 2026-07-21 in winter.
function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

// Timestamps, unlike dates, are real instants — those do belong in NZ time.
function formatDateTime(date: Date | null): string {
  return date
    ? date.toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
}

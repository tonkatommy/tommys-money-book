// The sync status page.
//
// Answers one question at a glance: is the database still filling itself?
// Every figure in the budget is downstream of this page, and a sync that has
// quietly stopped looks exactly like a sync with nothing to do. So the page
// leads with two separate times — the last successful sync and the newest
// transaction — because only the first one tells those two apart.
//
// A React Server Component, so the queries run on the server and only HTML
// reaches the browser. No API route needed for a read. There's no "Sync now"
// button: a full Akahu sync takes long enough that holding a request open for
// it is a worse trade than the CLI (README: Run a sync right now).
//
// Layout follows the Money Book canvas (Sync.dc.html).

import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { getSyncStatus, STALE_AFTER_HOURS, type SyncStatusView } from "@/lib/sync/status";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState } from "@/components/ui/primitives";
import { parseBook, resolvePeriod } from "@/lib/budget/query";

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

export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod();
  const data = await load();

  return (
    <AppShell
      active="sync"
      book={book}
      period={period}
      basePath="/sync"
      splitFortnightly={settings.splitFortnightly}
    >
      {data.ok &&
        data.status.alerts.map((alert, index) => (
          <Alert key={index} level={alert.level} icon={alert.level === "warning" ? "sync" : undefined}>
            {alert.message}
          </Alert>
        ))}

      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Sync status</h1>
          <span className="t-s ink2">
            Every morning the worker fetches new transactions from ANZ and BNZ
            through Akahu.
          </span>
        </div>
      </div>

      {!data.ok ? (
        <div className="banner bad" role="alert">
          <span className="i i-alert" aria-hidden="true" />
          <div>
            <p className="bt">Database unreachable</p>
            <pre className="mono scroll t-xs" style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>
              {data.error}
            </pre>
            <p className="bb">
              Is Postgres running? Try <code className="mono">docker compose up -d db</code>
            </p>
          </div>
        </div>
      ) : (
        <Healthy data={data} />
      )}
    </AppShell>
  );
}

function Healthy({ data }: { data: Extract<PageData, { ok: true }> }) {
  const { status } = data;
  const stale = status.alerts.length > 0;
  const newest = status.accounts
    .map((a) => a.lastTransactionAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <>
      <section className="health" aria-label="Sync health">
        <div
          className="card pad-l stack"
          style={{ gap: 6, borderWidth: 2, borderColor: stale ? "var(--warn-line)" : "var(--accent)" }}
        >
          <span className="lbl">Last successful sync</span>
          <span className="t-l mono" style={{ fontWeight: 600 }}>
            {formatDateTime(status.lastSuccessfulRun)}
          </span>
          <span className="t-s ink2">
            {status.lastSuccessfulRun ? "Should never be more than a day old." : "None on record yet."}
          </span>
        </div>
        <div className="card pad-l stack" style={{ gap: 6 }}>
          <span className="lbl">Newest transaction</span>
          <span className="t-l mono" style={{ fontWeight: 600 }}>
            {formatDate(newest ?? null)}
          </span>
          <span className="t-s ink2">Can be days old on a quiet weekend. That&apos;s fine.</span>
        </div>
        <div className="card pad-l stack" style={{ gap: 6 }}>
          <span className="lbl">Flagged overdue after</span>
          <span className="t-l mono" style={{ fontWeight: 600 }}>
            {STALE_AFTER_HOURS} hours
          </span>
          <span className="t-s ink2">One missed morning, never a normal overnight gap.</span>
        </div>
      </section>

      <div className="banner info">
        <span className="i i-info" aria-hidden="true" />
        <div>
          <p className="bt">A stopped sync looks just like a quiet day</p>
          <p className="bb">
            So there are two separate times above. If the last successful sync
            gets too old, figures everywhere carry a warning and the header dot
            changes shape.
          </p>
        </div>
      </div>

      <Accounts accounts={status.accounts} />
      <Runs runs={status.runs} />

      <p className="t-xs ink3">
        Database: <span className="mono">{data.dbVersion}</span> · server time (NZ){" "}
        <span className="mono">{data.now}</span>
      </p>
    </>
  );
}

function Accounts({ accounts }: { accounts: SyncStatusView["accounts"] }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon="sync"
        title="No accounts yet"
        body="Run npm run sync:baseline to pull them from Akahu."
      />
    );
  }

  return (
    <section className="txl" aria-label="Accounts">
      <div className="grp-h">
        <span className="sect-t">Accounts · {accounts.length}</span>
        <span className="t-xs ink2">Balanced = our running total matches the bank&apos;s balance</span>
      </div>
      <div className="acch">
        <span>Account</span>
        <span>Book</span>
        <span style={{ textAlign: "right" }}>Balance</span>
        <span>Checks</span>
        <span>Last synced</span>
      </div>
      {accounts.map((account) => (
        <div key={account.id} className="acc">
          <span className="an">
            <span className="semi">{account.name}</span>
            <span className="range">
              {account.transactionCount} transactions · history from{" "}
              {formatDate(account.historyStartDate)}
            </span>
          </span>
          <span className="abk">
            {account.book ? (
              <>
                <span className={`bk ${account.book === "BUSINESS" ? "b" : "p"}`} aria-hidden="true" />{" "}
                {account.book === "BUSINESS" ? "Business" : "Personal"}
              </>
            ) : (
              <span className="na">none</span>
            )}
          </span>
          <span className="ab m">
            {account.balanceCents !== null ? formatNZD(account.balanceCents) : "—"}
          </span>
          <span className="as">
            {!account.book && <span className="badge b-warn">Needs mapping</span>}
            {account.akahuStatus === "INACTIVE" && <span className="badge b-bad">Needs re-consent</span>}
            {account.driftCents !== null && account.driftCents !== 0 && (
              <span className={account.driftIsPersistent ? "badge b-bad" : "badge b-warn"}>
                {account.driftIsPersistent && <span className="i i-alert" aria-hidden="true" />}
                Drift {formatNZD(account.driftCents)}
                {account.driftIsPersistent ? " · persisting" : ""}
              </span>
            )}
            {account.driftCents === 0 && (
              <span className="badge b-ok">
                <span className="i i-check" aria-hidden="true" />
                Balanced
              </span>
            )}
            {/* Neutral, not a warning. Pending authorisations are normal on a
                card account and reconciliation already accounts for them, but
                the figure explains why the bank's balance is lower than what
                has actually cleared. */}
            {account.pendingTotalCents !== 0 && (
              <span className="badge b-pend">{formatNZD(account.pendingTotalCents)} pending</span>
            )}
          </span>
          <span className="al">{formatDateTime(account.lastSyncedAt)}</span>
        </div>
      ))}
    </section>
  );
}

function Runs({ runs }: { runs: SyncStatusView["runs"] }) {
  if (runs.length === 0) {
    return (
      <EmptyState icon="sync" title="No sync runs yet" body="Run npm run sync:baseline." />
    );
  }

  return (
    <section className="txl" aria-label="Recent sync runs">
      <div className="grp-h">
        <span className="sect-t">Recent runs</span>
        {/* Duplicates are shown on purpose: a healthy daily sync always has
            some, because the window deliberately re-reads a week. Zero would
            mean the overlap is gone. */}
        <span className="t-xs ink2">
          Already held = rows seen before and skipped. Some every day is healthy.
        </span>
      </div>
      {runs.map((run) => (
        <div key={run.id} className="run">
          <span className="num t-s">{formatDateTime(run.startedAt)}</span>
          <span>
            <span className={runBadge(run.status)}>{runLabel(run.status)}</span>
          </span>
          <span className="t-s ink2">
            {run.trigger.toLowerCase()}
            {run.durationMs !== null ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}
            {run.error ? ` · ${run.error}` : ""}
          </span>
          <span className="num t-s">{run.inserted} new</span>
          <span className="num t-s ink3">{run.duplicates} held</span>
        </div>
      ))}
    </section>
  );
}

function runBadge(status: string): string {
  if (status === "SUCCESS") return "badge b-ok";
  if (status === "FAILED") return "badge b-bad";
  if (status === "PARTIAL") return "badge b-warn";
  return "badge";
}

function runLabel(status: string): string {
  return status[0] + status.slice(1).toLowerCase();
}

// Dates are stored as bare DATEs at UTC midnight, so they're formatted in UTC.
// Using NZ time here would display 20/07/2026 as 21/07/2026 in winter.
function formatDate(date: Date | null): string {
  if (!date) return "—";
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getUTCFullYear()}`;
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

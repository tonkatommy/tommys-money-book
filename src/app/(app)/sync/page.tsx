// The sync status page.
//
// Answers one question at a glance: is the database still filling itself? It
// was the Phase 1 deliverable and lived at `/` until the budget took over as
// the daily-driver screen; the content is unchanged, but the local Card,
// Badge, StatusDot and Row helpers it used to carry are gone in favour of the
// shared design system components.
//
// A React Server Component, so the queries run on the server and only HTML
// reaches the browser. No API route needed for a read.

import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { getSyncStatus, type SyncStatusView } from "@/lib/sync/status";
import { AppShell } from "@/components/app-shell";
import {
  Alert,
  Badge,
  Card,
  StatusDot,
  type Tone,
} from "@/components/ui/primitives";
import { KV, ScreenHead } from "@/components/ui/data";
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
      <div className="mb-stack">
        <ScreenHead
          title="Sync status"
          sub="Every figure in the budget is downstream of this page. A sync that has quietly stopped looks exactly like a sync with nothing to do."
        />

        {!data.ok ? (
          <Card>
            <StatusDot tone="error" label="Database unreachable" />
            <pre
              className="mb-num mb-scroll-x"
              style={{
                margin: "var(--space-4) 0 0",
                padding: "var(--space-3)",
                background: "var(--surface-inset)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              {data.error}
            </pre>
            <p
              style={{
                margin: "var(--space-4) 0 0",
                fontSize: "var(--text-sm)",
                color: "var(--text-tertiary)",
              }}
            >
              Is Postgres running? Try <Code>docker compose up -d db</Code>
            </p>
          </Card>
        ) : (
          <>
            {data.status.alerts.map((alert, index) => (
              <Alert key={index} level={alert.level}>
                {alert.message}
              </Alert>
            ))}

            <Accounts accounts={data.status.accounts} />
            <Runs runs={data.status.runs} />

            <Card title="Database">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                }}
              >
                <KV label="Version" value={data.dbVersion} />
                <KV label="Server time (NZ)" value={data.now} />
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Accounts({ accounts }: { accounts: SyncStatusView["accounts"] }) {
  if (accounts.length === 0) {
    return (
      <Card title="Accounts">
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
          No accounts yet. Run <Code>npm run sync:baseline</Code> to pull them
          from Akahu.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Accounts" padded={false}>
      <div className="mb-rows">
        {accounts.map((account) => (
          <div key={account.id} className="mb-row" style={{ padding: "14px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-medium)",
                  color: "var(--text-primary)",
                }}
              >
                {account.name}
              </span>
              <span className="mb-num" style={{ fontSize: "var(--text-sm)" }}>
                {account.balanceCents !== null
                  ? formatNZD(account.balanceCents)
                  : "—"}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                margin: "var(--space-3) 0",
              }}
            >
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

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <KV label="Transactions" value={String(account.transactionCount)} />
              <KV label="History from" value={formatDate(account.historyStartDate)} />
              <KV
                label="Latest transaction"
                value={formatDate(account.lastTransactionAt)}
              />
              <KV label="Last synced" value={formatDateTime(account.lastSyncedAt)} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Runs({ runs }: { runs: SyncStatusView["runs"] }) {
  if (runs.length === 0) {
    return (
      <Card title="Recent sync runs">
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
          Nothing yet. Run <Code>npm run sync:baseline</Code>.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Recent sync runs">
      {/* Genuinely tabular, so it stays a table and scrolls sideways on a
          phone rather than being restacked into something harder to scan. */}
      <div className="mb-scroll-x">
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
          }}
        >
          <thead>
            <tr
              style={{
                textAlign: "left",
                fontSize: "var(--text-xs)",
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              <th style={cell}>Started</th>
              <th style={cell}>Trigger</th>
              <th style={cell}>Status</th>
              <th style={{ ...cell, textAlign: "right" }}>New</th>
              {/* Duplicates are shown on purpose: a healthy daily sync always
                  has some, because the window deliberately re-reads a week.
                  Zero duplicates would mean the overlap is gone. */}
              <th style={{ ...cell, textAlign: "right" }}>Already held</th>
              <th style={{ ...cell, textAlign: "right" }}>Took</th>
            </tr>
          </thead>
          <tbody style={{ color: "var(--text-secondary)" }}>
            {runs.map((run) => (
              <tr key={run.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>
                  {formatDateTime(run.startedAt)}
                </td>
                <td style={{ ...cell, color: "var(--text-tertiary)" }}>
                  {run.trigger}
                </td>
                <td style={cell}>
                  <Badge tone={runTone(run.status)}>{run.status}</Badge>
                </td>
                <td className="mb-num" style={{ ...cell, textAlign: "right" }}>
                  {run.inserted}
                </td>
                <td
                  className="mb-num"
                  style={{ ...cell, textAlign: "right", color: "var(--text-muted)" }}
                >
                  {run.duplicates}
                </td>
                <td
                  className="mb-num"
                  style={{ ...cell, textAlign: "right", color: "var(--text-muted)" }}
                >
                  {run.durationMs !== null
                    ? `${(run.durationMs / 1000).toFixed(1)}s`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const cell = { padding: "10px 14px 10px 0" } as const;

function runTone(status: string): Tone {
  if (status === "SUCCESS") return "ok";
  if (status === "FAILED") return "error";
  if (status === "PARTIAL") return "warning";
  return "neutral";
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        background: "var(--surface-inset)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-sm)",
        padding: "2px 6px",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
      }}
    >
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

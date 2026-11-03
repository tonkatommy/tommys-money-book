// Money moving between your own accounts, waiting to be confirmed.
//
// Getting a transfer wrong is the quietest error in the whole app. Treat one
// as income and the books show money that was never earned; treat real income
// as a transfer and it disappears. Both leave a perfectly balanced set of
// books, so nothing complains and no total looks odd.
//
// Which is why this screen shows tier 2 and only tier 2. Tier 1 — ANZ's own
// reciprocal descriptions, where both legs name the other's account — is
// provable from the data and is written by `transfers:detect --confirm`.
// Tier 3 is blind same-day amount matching, which over this baseline produces
// hundreds of candidates and is not attempted at all.
//
// Within tier 2, CONTESTED suggestions are listed but have no button. An
// outgoing leg with two plausible counterparts is exactly the case where a
// confident single answer is dangerous: `Flat Expenses Utilities` for $80
// matches both Tommy's own transfer and Bonnie's flatmate contribution on the
// same day, and netting the wrong one erases $1,360 of real income across the
// baseline. Those go to the CLI, with a human looking at them.
//
// Layout follows the Money Book canvas (Transfers.dc.html). The canvas also
// drew per-pair "Not a transfer" and in-app "Resolve" buttons; neither exists
// as an action, and contested pairs are CLI-only by design, so they're left
// out rather than drawn as buttons that do nothing.

import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, Icon } from "@/components/ui/primitives";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { detectTransfers } from "@/lib/transfers/run";
import type { TransferSuggestion } from "@/lib/transfers/detect";
import { getShellStatus } from "@/lib/shell";
import { ConfirmGroupForm } from "./confirm-form";

export const dynamic = "force-dynamic";

const LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;

const EXPLAIN: Record<(typeof LEVELS)[number], string> = {
  HIGH: "Both legs end with the same particulars and the outgoing description names the destination account.",
  MEDIUM: "One of those two signals, not both.",
  LOW: "Same day and exactly opposite amounts, and nothing else agrees.",
};

const SHOWN_PER_GROUP = 8;

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod();

  // Dry run: this is a read. Nothing is written until a button is pressed.
  const [{ suggestions }, status] = await Promise.all([
    detectTransfers(prisma, { dryRun: true }),
    getShellStatus(book, period),
  ]);

  const uncontested = suggestions.filter((suggestion) => !suggestion.contested);
  const contested = suggestions.filter((suggestion) => suggestion.contested);

  // Contested suggestions share an outgoing leg, so they're grouped by it:
  // one payment, its candidate matches underneath.
  const contestedByOut = new Map<string, TransferSuggestion[]>();
  for (const s of contested) {
    contestedByOut.set(s.outLegId, [...(contestedByOut.get(s.outLegId) ?? []), s]);
  }

  // Each unconfirmed outgoing leg is money counted as spending on one side
  // and income on the other. Counted once per leg, so a contested payment
  // with two candidates isn't double-counted here.
  const doubleCountedCents = [...new Map(suggestions.map((s) => [s.outLegId, s.amountCents])).values()]
    .reduce((sum, cents) => sum + cents, 0);

  return (
    <AppShell
      active="transfers"
      book={book}
      period={period}
      basePath="/transfers"
      splitFortnightly={settings.splitFortnightly}
      lockBook="both"
    >
      {status.health !== "ok" && (
        <Alert
          level={status.health === "failing" ? "error" : "warning"}
          title="Suggestions may be incomplete"
          affects="Unmatched until the feed catches up: transfers whose other leg hasn't synced"
        >
          The bank feed is {status.health === "failing" ? "failing" : "overdue"}, so
          a transfer whose other half hasn&apos;t arrived can&apos;t be paired yet.
        </Alert>
      )}

      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">Transfers to confirm</h1>
          <span className="t-s ink2">
            Suggested pairs of money moving between your own accounts.
          </span>
        </div>
      </div>

      <section className="card pad-l grid cols-main" style={{ gap: 20, alignItems: "center" }} aria-label="Why this matters">
        <div className="stack" style={{ gap: 8 }}>
          <h2 className="t-m">Why clear this queue?</h2>
          <p className="t-s ink2">
            Until you confirm it, a transfer looks like two unrelated things:
            spending on one account and income on the other. Both totals come out
            too high, and budgets can look overspent.
          </p>
          {suggestions.length > 0 && (
            <p className="t-s">
              <span className="semi">Right now:</span>{" "}
              <span className="num">{formatNZD(doubleCountedCents)}</span> is counted as
              both spending and income.
            </p>
          )}
        </div>
        <div className="stack" style={{ gap: 8, background: "var(--sunk)", borderRadius: 12, padding: 14 }}>
          <div className="row between wrap t-s">
            <span>Account A · out</span>
            <span className="badge b-need">counts as spending</span>
          </div>
          <div className="row between wrap t-s">
            <span>Account B · in</span>
            <span className="badge b-need">counts as income</span>
          </div>
          <div className="hr" />
          <div className="row between wrap t-s">
            <span className="semi">After confirming</span>
            <span className="badge b-xfer">
              <Icon name="swap" />
              Transfer · counts as neither
            </span>
          </div>
        </div>
      </section>

      {suggestions.length === 0 && (
        <EmptyState
          icon="check"
          title="All transfers confirmed"
          body="Nothing is being counted as both spending and income. New suggestions arrive with each sync."
        />
      )}

      {LEVELS.map((level) => {
        const group = uncontested.filter((s) => s.confidence === level);
        if (group.length === 0) return null;
        const totalCents = group.reduce((sum, s) => sum + s.amountCents, 0);
        const label = `${level[0]}${level.slice(1).toLowerCase()} confidence`;

        return (
          <section key={level} className="txl" aria-label={label}>
            <div className="grp-h">
              <span className="stack" style={{ gap: 2 }}>
                <span className="sect-t">
                  {label} · {group.length}
                </span>
                <span className="t-xs ink2">
                  {EXPLAIN[level]}{" "}
                  None is contested: each outgoing leg has exactly
                  one plausible match, so confirming the group can&apos;t pick the
                  wrong one.
                </span>
              </span>
              <ConfirmGroupForm confidence={level} count={group.length} />
            </div>
            {group.slice(0, SHOWN_PER_GROUP).map((s) => (
              <Pair key={`${s.outLegId}-${s.inLegId}`} suggestion={s} />
            ))}
            {group.length > SHOWN_PER_GROUP && (
              <p className="t-xs ink3" style={{ padding: "12px 20px" }}>
                … and {group.length - SHOWN_PER_GROUP} more, {formatNZD(totalCents)} in
                total. The button confirms all {group.length}.
              </p>
            )}
          </section>
        );
      })}

      {contestedByOut.size > 0 && (
        <section
          className="txl"
          aria-label="Contested"
          style={{ borderStyle: "dashed", borderColor: "var(--warn-line)" }}
        >
          <div className="grp-h" style={{ background: "var(--warn-bg)" }}>
            <span className="stack" style={{ gap: 2 }}>
              <span className="sect-t">
                <Icon name="warn" size="sm" />
                Contested · {contestedByOut.size}
              </span>
              <span className="t-xs ink2">
                One payment, more than one possible match. There&apos;s deliberately
                no confirm button: picking wrong would erase real income and still
                leave the books balanced. Run{" "}
                <code className="mono">npm run transfers:detect</code>, which prints
                the exact command for each, and confirm them one at a time.
              </span>
            </span>
          </div>
          {[...contestedByOut.values()].slice(0, 10).map((candidates) => {
            const out = candidates[0];
            return (
              <div key={out.outLegId} className="pair">
                <div className="leg">
                  <span className="acct">{out.fromAccount}</span>
                  <span className="m">{formatNZD(out.amountCents)}</span>
                  <span className="when">
                    {nzDate(out.date)} · out · {out.outDescription}
                  </span>
                </div>
                <div className="arr">
                  <Icon name="chev" />
                  <span className="t">to one of</span>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {candidates.map((c) => (
                    <div key={c.inLegId} className="leg">
                      <span className="acct">{c.toAccount}</span>
                      <span className="m in">+{formatNZD(c.amountCents)}</span>
                      <span className="when">in · {c.inDescription}</span>
                    </div>
                  ))}
                </div>
                <div className="why">
                  <span>Resolve from the command line, having looked at both.</span>
                </div>
              </div>
            );
          })}
          {contestedByOut.size > 10 && (
            <p className="t-xs ink3" style={{ padding: "12px 20px" }}>
              … and {contestedByOut.size - 10} more.
            </p>
          )}
        </section>
      )}
    </AppShell>
  );
}

function Pair({ suggestion: s }: { suggestion: TransferSuggestion }) {
  return (
    <div className="pair">
      <div className="leg">
        <span className="acct">{s.fromAccount}</span>
        <span className="m">{formatNZD(s.amountCents)}</span>
        <span className="when">
          {nzDate(s.date)} · out · {s.outDescription}
        </span>
      </div>
      <div className="arr">
        <Icon name="chev" />
        <span className="t">to</span>
      </div>
      <div className="leg">
        <span className="acct">{s.toAccount}</span>
        <span className="m in">+{formatNZD(s.amountCents)}</span>
        <span className="when">in · {s.inDescription}</span>
      </div>
      <div className="why">
        {/* Cross-book pairs are OWNER money, not a netting transfer
            (invariant 4), and confirming writes them that way. */}
        {s.crossBook && (
          <span className="badge b-owner">
            <span className="bk b" aria-hidden="true" />
            Owner, not transfer
          </span>
        )}
        <span>{s.reasons.join(" · ")}</span>
      </div>
    </div>
  );
}

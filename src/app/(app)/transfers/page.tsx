// Money moving between your own accounts, waiting to be confirmed.
//
// Getting a transfer wrong is the quietest error in the whole app. Treat one
// as income and the books show money that was never earned; treat real income
// as a transfer and it disappears. Both leave a perfectly balanced set of
// books, so nothing complains and no total looks odd.
//
// Which is why this screen shows tier 2 and only tier 2. Tier 1 — ANZ's own
// reciprocal descriptions, where both legs name the other's account — is
// provable from the data and is already written by the sync path. Tier 3 is
// blind same-day amount matching, which over this baseline produces hundreds
// of candidates and is not attempted at all.
//
// Within tier 2, CONTESTED suggestions are listed but have no button. An
// outgoing leg with two plausible counterparts is exactly the case where a
// confident single answer is dangerous: `Flat Expenses Utilities` for $80
// matches both Tommy's own transfer and Bonnie's flatmate contribution on the
// same day, and netting the wrong one erases $1,360 of real income across the
// baseline. Those go to the CLI, with a human looking at them.

import { AppShell } from "@/components/app-shell";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { ScreenHead } from "@/components/ui/data";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { detectTransfers } from "@/lib/transfers/run";
import { ConfirmGroupForm } from "./confirm-form";

export const dynamic = "force-dynamic";

const LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;

const EXPLAIN: Record<(typeof LEVELS)[number], string> = {
  HIGH:
    "Both legs end with the same particulars and the outgoing description names the destination account.",
  MEDIUM: "One of those two signals, not both.",
  LOW: "Same day and exactly opposite amounts, and nothing else agrees.",
};

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod();

  // Dry run: this is a read. Nothing is written until a button is pressed.
  const { suggestions } = await detectTransfers(prisma, { dryRun: true });

  const uncontested = suggestions.filter((suggestion) => !suggestion.contested);
  const contested = suggestions.filter((suggestion) => suggestion.contested);

  return (
    <AppShell
      active="transfers"
      book={book}
      period={period}
      basePath="/transfers"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Transfers to confirm"
          sub={`${suggestions.length} suggested pair${suggestions.length === 1 ? "" : "s"} · ${contested.length} need you to look`}
        />

        {suggestions.length === 0 && (
          <Card>
            <EmptyState
              icon="✓"
              title="Nothing waiting"
              body="Every movement between your own accounts that can be paired has been. New ones appear here after a sync."
            />
          </Card>
        )}

        {LEVELS.map((level) => {
          const group = uncontested.filter((s) => s.confidence === level);
          if (group.length === 0) return null;

          const totalCents = group.reduce((sum, s) => sum + s.amountCents, 0);

          return (
            <Card
              key={level}
              title={`${level[0]}${level.slice(1).toLowerCase()} confidence`}
              action={<Badge tone={level === "HIGH" ? "ok" : "neutral"}>{group.length}</Badge>}
            >
              <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6 }}>
                {EXPLAIN[level]} None of these is contested — each outgoing leg
                has exactly one plausible counterpart, so confirming the group
                cannot pick the wrong one.
              </p>

              <div className="mb-rows">
                {group.slice(0, 8).map((suggestion) => (
                  <div key={`${suggestion.outLegId}-${suggestion.inLegId}`} className="mb-row" style={{ padding: "10px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", minWidth: 0 }}>
                        {suggestion.fromAccount} → {suggestion.toAccount}
                        {suggestion.crossBook && (
                          <>
                            {" "}
                            <Badge tone="warning">owner, not transfer</Badge>
                          </>
                        )}
                      </span>
                      <span className="mb-num" style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}>
                        {formatNZD(suggestion.amountCents)}
                      </span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      {nzDate(suggestion.date)} · {suggestion.outDescription} →{" "}
                      {suggestion.inDescription}
                    </div>
                  </div>
                ))}

                {group.length > 8 && (
                  <div style={{ padding: "10px 0", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    … and {group.length - 8} more, {formatNZD(totalCents)} in total.
                  </div>
                )}
              </div>

              <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
                <ConfirmGroupForm confidence={level} count={group.length} />
              </div>
            </Card>
          );
        })}

        {contested.length > 0 && (
          <Card
            title="Contested — these need you"
            action={<Badge tone="warning">{contested.length}</Badge>}
          >
            <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6 }}>
              The same outgoing leg has more than one plausible counterpart, so
              there is no button here on purpose. Over this data a standing
              order lands on the same day for the same amount as a genuine
              flatmate payment, again and again — netting the wrong one would
              erase real income and still leave the books balanced. Confirm
              these one at a time, having looked at them:{" "}
              <code>npm run transfers:detect</code> prints the exact command for
              each.
            </p>

            <div className="mb-rows">
              {contested.slice(0, 10).map((suggestion) => (
                <div key={`${suggestion.outLegId}-${suggestion.inLegId}`} className="mb-row" style={{ padding: "10px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--text-sm)", minWidth: 0 }}>
                      {suggestion.outDescription} → {suggestion.inDescription}
                    </span>
                    <span className="mb-num" style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}>
                      {formatNZD(suggestion.amountCents)}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {nzDate(suggestion.date)} · {suggestion.fromAccount} →{" "}
                    {suggestion.toAccount}
                  </div>
                </div>
              ))}

              {contested.length > 10 && (
                <div style={{ padding: "10px 0", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  … and {contested.length - 10} more.
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

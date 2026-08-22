// Adding cash the bank never saw.
//
// The baseline has $3,870 of ATM withdrawals whose destination is genuinely
// unknowable from a feed. Cash Withdrawals exists as a category so that money
// isn't guessed into Groceries; this screen is how the other half of that
// story gets recorded.

import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/primitives";
import { ScreenHead } from "@/components/ui/data";
import { prisma } from "@/lib/prisma";
import { nzToday } from "@/lib/budget/period";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { CASH_ACCOUNT_NAMES } from "@/lib/accounts/cash";
import { ManualEntryForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod();

  const [categories, cashAccounts] = await Promise.all([
    prisma.category.findMany({
      where: { kind: { in: ["EXPENSE", "INCOME"] } },
      orderBy: [{ book: "asc" }, { name: "asc" }],
      select: { id: true, name: true, book: true },
    }),
    prisma.account.count({
      where: { name: { in: Object.values(CASH_ACCOUNT_NAMES) } },
    }),
  ]);

  return (
    <AppShell
      active="transactions"
      book={book}
      period={period}
      basePath="/transactions/new"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title="Add a cash entry"
          sub="For money the bank never saw — cash out of a withdrawal, a koha, anything settled in notes."
        />

        {cashAccounts < 2 && (
          <Card>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--status-error)" }}>
              The cash accounts haven&rsquo;t been created yet, so saving will
              fail. Run <code>npm run accounts:seed-cash</code> first.
            </p>
          </Card>
        )}

        <ManualEntryForm
          book={book}
          today={nzToday().toISOString().slice(0, 10)}
          categories={categories}
        />
      </div>
    </AppShell>
  );
}

// Adding cash the bank never saw.
//
// The baseline has $3,870 of ATM withdrawals whose destination is genuinely
// unknowable from a feed. Cash Withdrawals exists as a category so that money
// isn't guessed into Groceries; this screen is how the other half of that
// story gets recorded.
//
// Layout follows the Money Book canvas (AddCash.dc.html).

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Alert, Icon } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
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
      <div className="stack" style={{ gap: 16, width: "100%", maxWidth: 640 }}>
        <Link
          href={withBook("/transactions", book)}
          className="row t-s semi"
          style={{ textDecoration: "none", minHeight: 44 }}
        >
          <Icon name="back" size="sm" />
          Transactions
        </Link>
        <h1 className="t-xl">Add cash entry</h1>
        <p className="t-s ink2">
          For money the bank never sees: cash out of a withdrawal, a koha,
          anything settled in notes. You can edit it later; nothing is ever deleted.
        </p>

        {cashAccounts < 2 && (
          <Alert
            level="error"
            title="The cash accounts don't exist yet, so saving will fail"
          >
            Run <code className="mono">npm run accounts:seed-cash</code> first.
          </Alert>
        )}

        <Alert level="info" title="Only for cash with no bank withdrawal behind it">
          Spending from a withdrawal already categorised as Cash Withdrawals is
          counted. Adding the purchases too would count the same money twice.
        </Alert>

        <ManualEntryForm
          book={book}
          today={nzToday().toISOString().slice(0, 10)}
          categories={categories}
          cancelHref={withBook("/transactions", book)}
        />
        <p className="t-xs ink3">
          Left blank, the category shows as &ldquo;needs a category&rdquo; and is
          counted in the warning on Budget.
        </p>
      </div>
    </AppShell>
  );
}

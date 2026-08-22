// One transaction, and the two or three things you can do to it.
//
// For a bank row the facts are read-only. They are the bank's record of what
// happened, and an app that let you edit the date or the amount would end up
// disagreeing with the statement while looking authoritative — the failure
// mode where you trust the wrong number. What you CAN change is the
// interpretation: which category it belongs to, and a note about it.
//
// A manual row has no bank record to protect, so its fields become a third
// form (spec §4b).

import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, CategoryTag } from "@/components/ui/primitives";
import { KV, ScreenHead } from "@/components/ui/data";
import { withBook } from "@/components/ui/nav";
import { prisma } from "@/lib/prisma";
import { formatNZD } from "@/lib/money";
import { nzDate } from "@/lib/budget/period";
import { resolvePeriod } from "@/lib/budget/query";
import { getFilterOptions } from "@/lib/transactions/query";
import { CategoryForm, ManualFieldsForm, NotesForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: {
      account: { select: { name: true, book: true } },
      category: { select: { id: true, name: true, book: true } },
    },
  });

  if (!transaction) notFound();

  // The book comes from the transaction's own account, never from the query
  // string: the category options this page offers must match the account the
  // row actually sits on, or the dropdown would offer a save the server will
  // refuse. An unmapped account has no book, so it offers nothing.
  const book = transaction.account.book;
  const { period, settings } = await resolvePeriod();
  const options = book ? await getFilterOptions(book) : { categories: [] };

  const isManual = transaction.source === "MANUAL";

  return (
    <AppShell
      active="transactions"
      book={book ?? "PERSONAL"}
      period={period}
      basePath="/transactions"
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-stack">
        <ScreenHead
          title={transaction.payee ?? transaction.description}
          sub={
            <>
              <Link href={withBook("/transactions", book ?? "PERSONAL")}>
                ← All transactions
              </Link>
            </>
          }
        />

        <Card title="What the bank says" action={isManual ? <Badge tone="neutral">cash entry</Badge> : undefined}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <KV label="Date" value={nzDate(transaction.date)} />
            <KV
              label="Amount"
              value={formatNZD(transaction.amountCents)}
              tone={transaction.amountCents > 0 ? "var(--money-in)" : undefined}
            />
            <KV label="Account" value={transaction.account.name} mono={false} />
            <KV label="Description" value={transaction.description} mono={false} />
            {transaction.payee && <KV label="Payee" value={transaction.payee} mono={false} />}
            {transaction.merchantName && (
              <KV label="Merchant" value={transaction.merchantName} mono={false} />
            )}
            {transaction.akahuCategoryName && (
              <KV label="Akahu called it" value={transaction.akahuCategoryName} mono={false} />
            )}
            <KV
              label="Category now"
              value={
                transaction.category ? (
                  <CategoryTag
                    name={transaction.category.name}
                    book={transaction.category.book}
                  />
                ) : (
                  <Badge tone="warning">Needs a category</Badge>
                )
              }
              mono={false}
            />
            {transaction.categorySource && (
              <KV
                label="Decided by"
                value={
                  transaction.categorySource === "MANUAL"
                    ? "you, by hand"
                    : transaction.categorySource === "RULE"
                      ? "a rule in definitions.ts"
                      : "confirming a transfer pair"
                }
                mono={false}
              />
            )}
            {transaction.transferPairId && (
              <KV
                label="Transfer"
                value="Paired — nets to zero, so it is neither income nor an expense"
                mono={false}
              />
            )}
          </div>
        </Card>

        {isManual && (
          <ManualFieldsForm
            id={transaction.id}
            date={transaction.date.toISOString().slice(0, 10)}
            description={transaction.description}
            payee={transaction.payee}
            amountCents={transaction.amountCents}
            notes={transaction.notes}
          />
        )}

        {book ? (
          <CategoryForm
            id={transaction.id}
            categoryId={transaction.category?.id ?? null}
            categories={options.categories}
          />
        ) : (
          <Card title="Category">
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              {transaction.account.name} has not been assigned to a book yet, so
              there are no categories to choose from. Run{" "}
              <code>npm run accounts:map</code> first — guessing the book is how
              business spending ends up in the personal ledger.
            </p>
          </Card>
        )}

        <NotesForm id={transaction.id} notes={transaction.notes} />
      </div>
    </AppShell>
  );
}

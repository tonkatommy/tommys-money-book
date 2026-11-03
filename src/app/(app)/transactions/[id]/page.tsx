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
//
// Layout follows the Money Book canvas (TxDetail.dc.html).

import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Icon, Provenance } from "@/components/ui/primitives";
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
  const income = transaction.amountCents > 0;
  const bookName = book === "BUSINESS" ? "Business" : "Personal";

  const fact = (label: React.ReactNode, value: React.ReactNode, mono = false) => (
    <div className="li">
      <dt className="grow t-s ink2">{label}</dt>
      <dd className={mono ? "num" : "t-s"} style={{ margin: 0, textAlign: "right" }}>
        {value}
      </dd>
    </div>
  );

  return (
    <AppShell
      active="transactions"
      book={book ?? "PERSONAL"}
      period={period}
      basePath="/transactions"
      splitFortnightly={settings.splitFortnightly}
    >
      <Link
        href={withBook("/transactions", book ?? "PERSONAL")}
        className="row t-s semi"
        style={{ textDecoration: "none", minHeight: 44 }}
      >
        <Icon name="back" size="sm" />
        Transactions
      </Link>

      <div className="page-h">
        <div className="grow stack" style={{ gap: 8 }}>
          <div className="row wrap">
            {isManual && (
              <span className="badge b-cash">
                <Icon name="cash" />
                Cash entry
              </span>
            )}
            {transaction.transferPairId && (
              <span className="badge b-xfer">
                <Icon name="swap" />
                Transfer
              </span>
            )}
            <span className="range">{nzDate(transaction.date)}</span>
          </div>
          <h1 className="t-xl">{transaction.payee ?? transaction.description}</h1>
        </div>
        <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
          <span className={`dirl ${income ? "in" : "out"}`}>
            <Icon name={income ? "in" : "out"} size="sm" />
            {income ? "Money in" : "Money out"}
          </span>
          <span className={income ? "m in" : "m"} style={{ fontSize: 36 }}>
            {income ? "+" : ""}
            {formatNZD(Math.abs(transaction.amountCents))}
          </span>
        </div>
      </div>

      <div className="grid cols-2" style={{ gap: 20, alignItems: "start" }}>
        {isManual ? (
          <ManualFieldsForm
            id={transaction.id}
            date={transaction.date.toISOString().slice(0, 10)}
            description={transaction.description}
            payee={transaction.payee}
            amountCents={transaction.amountCents}
            notes={transaction.notes}
          />
        ) : (
          <section className="card pad-l stack" style={{ gap: 14 }} aria-label="What the bank says">
            <div className="row between">
              <h2 className="t-m">What the bank says</h2>
              <span className="badge">
                <Icon name="lock" />
                Read only
              </span>
            </div>
            <dl className="stack" style={{ gap: 0, margin: 0 }}>
              {fact("Date", nzDate(transaction.date), true)}
              {fact(
                "Amount",
                `${formatNZD(Math.abs(transaction.amountCents))} ${income ? "credit" : "debit"}`,
                true,
              )}
              {fact("Description", <span className="mono">{transaction.description}</span>)}
              {transaction.payee && fact("Payee", transaction.payee)}
              {transaction.merchantName && fact("Merchant", transaction.merchantName)}
              {fact(
                "Account",
                <>
                  {transaction.account.name}
                  {book ? (
                    <>
                      {" · "}
                      <span className={`bk ${book === "BUSINESS" ? "b" : "p"}`} aria-hidden="true" />{" "}
                      {bookName}
                    </>
                  ) : (
                    " · no book yet"
                  )}
                </>,
              )}
              {transaction.akahuCategoryName &&
                fact(
                  <>
                    Bank&apos;s own label{" "}
                    <span className="tip" title="Akahu's category. Shown for reference, never used for your budget.">
                      ?
                    </span>
                  </>,
                  transaction.akahuCategoryName,
                )}
              {fact(
                "Category decided by",
                <Provenance
                  source={transaction.categorySource}
                  hasCategory={transaction.category !== null}
                />,
              )}
              {transaction.transferPairId &&
                fact("Transfer", "Paired: nets to zero, so it's neither income nor spending")}
            </dl>
          </section>
        )}

        <div className="stack" style={{ gap: 20 }}>
          {book ? (
            <CategoryForm
              id={transaction.id}
              categoryId={transaction.category?.id ?? null}
              categories={options.categories}
              bookName={bookName}
              source={transaction.categorySource}
            />
          ) : (
            <section className="banner" aria-label="Category">
              <Icon name="warn" />
              <div>
                <p className="bt">No categories until this account has a book</p>
                <p className="bb">
                  {transaction.account.name} hasn&apos;t been assigned to a book yet. Run{" "}
                  <code className="mono">npm run accounts:map</code> first: guessing the
                  book is how business spending ends up in the personal ledger.
                </p>
              </div>
            </section>
          )}

          <NotesForm id={transaction.id} notes={transaction.notes} />

          <p className="t-xs ink3">
            There&apos;s no delete. What the bank sent stays on record so every total
            can be traced. Wrong category? Change it.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

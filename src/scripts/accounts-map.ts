// Assign an account to a set of books. `npm run accounts:map`
//
// The one piece of human judgement in the whole Phase 1 pipeline. Akahu can
// tell us an account exists, its balance, and its transactions — it cannot
// know that the BNZ account is Tommy Tinkers' business account and the ANZ
// one is personal. That distinction is the golden rule of this app, so it
// gets set deliberately rather than guessed.
//
//   npm run accounts:map                                  # list everything
//   npm run accounts:map -- "BNZ Tommy Tinkers" BUSINESS  # assign one
//
// Phase 3 will put a UI over exactly this field; nothing here needs redoing.

import { runScript } from "./_run";
import { prisma } from "@/lib/prisma";
import { Book } from "@/generated/prisma/client";
import { formatNZD } from "@/lib/money";

void runScript("accounts", async () => {
  // npm passes everything after `--` through, so argv[2] onward is ours.
  const [target, bookArg] = process.argv.slice(2);

  if (!target) {
    await listAccounts();
    return;
  }

  const book = parseBook(bookArg);

  // Match on name or Akahu id, so you can paste either from the listing.
  const account = await prisma.account.findFirst({
    where: { OR: [{ name: target }, { akahuId: target }] },
  });

  if (!account) {
    throw new Error(
      `No account matching "${target}". Run without arguments to list them.`,
    );
  }

  await prisma.account.update({
    where: { id: account.id },
    data: { book },
  });

  console.log(`"${account.name}" is now in the ${book} book.`);
  console.log("");
  await listAccounts();
});

function parseBook(value: string | undefined): Book {
  const normalised = value?.trim().toUpperCase();

  if (normalised === Book.PERSONAL || normalised === Book.BUSINESS) {
    return normalised;
  }

  throw new Error(
    `Expected PERSONAL or BUSINESS as the second argument, got ` +
      `"${value ?? ""}".\n` +
      `  Usage: npm run accounts:map -- "ANZ Everyday" PERSONAL`,
  );
}

async function listAccounts(): Promise<void> {
  const accounts = await prisma.account.findMany({ orderBy: { name: "asc" } });

  if (accounts.length === 0) {
    console.log("No accounts yet — run `npm run sync:baseline` first.");
    return;
  }

  console.log("Accounts:");
  console.log("");

  for (const account of accounts) {
    const balance =
      account.balanceCents !== null ? formatNZD(account.balanceCents) : "—";

    console.log(`  ${account.name}`);
    console.log(`    book     ${account.book ?? "** NOT ASSIGNED **"}`);
    console.log(`    akahu id ${account.akahuId ?? "—"}`);
    console.log(`    balance  ${balance}`);
  }

  const unassigned = accounts.filter((a) => a.book === null);

  if (unassigned.length > 0) {
    console.log("");
    console.log(
      `${unassigned.length} account(s) still need a book. Until assigned, ` +
        `their transactions are stored but belong to neither set of books:`,
    );
    for (const account of unassigned) {
      console.log(`  npm run accounts:map -- "${account.name}" PERSONAL`);
    }
  }
}

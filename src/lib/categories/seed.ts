// Getting the category list from definitions.ts into the database.
//
// Idempotent by construction: categories are upserted on (name, book) and a
// category's rules are deleted and rewritten every run. That means
// definitions.ts is the single source of truth — removing a rule there
// removes it from the database, so the file always describes what is actually
// live. The alternative (additive seeding) leaves stale rules behind that
// nobody can find by reading the code, which is how a rule set becomes
// impossible to reason about.
//
// The one thing seeding will not do is delete a category that has
// transactions attached. Renaming a category in definitions.ts creates a new
// one and orphans the old; the seeder reports that rather than silently
// deleting the old category and stranding its transactions as uncategorised.

import type { PrismaClient } from "@/generated/prisma/client";
import { CATEGORY_DEFINITIONS, type CategoryDefinition } from "./definitions";
import { normaliseDescription } from "./normalise";

export type SeedResult = {
  categoriesCreated: number;
  categoriesUpdated: number;
  rulesWritten: number;
  /** In the database but no longer in definitions.ts, and still in use. */
  orphanedInUse: { name: string; book: string; transactions: number }[];
  /** In the database, no longer defined, unused — removed. */
  orphanedRemoved: string[];
};

/**
 * Patterns are stored ready to compare, not raw.
 *
 * Doing the work here rather than at match time means the matcher does one
 * cheap `includes` per rule instead of re-normalising constants thousands of
 * times, and — more usefully — a mistyped pattern is visible in the database
 * exactly as the matcher will see it.
 */
function canonicalPattern(field: string, pattern: string): string {
  return field === "DESCRIPTION"
    ? normaliseDescription(pattern)
    : pattern.toLowerCase();
}

export async function seedCategories(
  prisma: PrismaClient,
  definitions: readonly CategoryDefinition[] = CATEGORY_DEFINITIONS,
): Promise<SeedResult> {
  // Rules may scope to an account by name; resolve those up front so a typo
  // fails loudly here rather than producing a rule that silently matches
  // nothing.
  const accounts = await prisma.account.findMany({
    select: { id: true, name: true },
  });
  const accountIdByName = new Map(accounts.map((a) => [a.name, a.id]));

  const result: SeedResult = {
    categoriesCreated: 0,
    categoriesUpdated: 0,
    rulesWritten: 0,
    orphanedInUse: [],
    orphanedRemoved: [],
  };

  for (const definition of definitions) {
    const existing = await prisma.category.findUnique({
      where: { name_book: { name: definition.name, book: definition.book } },
    });

    const data = {
      name: definition.name,
      book: definition.book,
      kind: definition.kind,
      taxTag: definition.taxTag ?? null,
    };

    const category = existing
      ? await prisma.category.update({ where: { id: existing.id }, data })
      : await prisma.category.create({ data });

    if (existing) result.categoriesUpdated += 1;
    else result.categoriesCreated += 1;

    // Replace rules wholesale. Cheap (a few hundred rows) and it guarantees
    // the database matches the file rather than the union of every version
    // of the file that has ever been seeded.
    await prisma.categoryRule.deleteMany({ where: { categoryId: category.id } });

    for (const rule of definition.rules ?? []) {
      let accountId: string | null = null;

      if (rule.accountName) {
        accountId = accountIdByName.get(rule.accountName) ?? null;
        if (accountId === null) {
          throw new Error(
            `Rule for "${definition.name}" scopes to account ` +
              `"${rule.accountName}", which does not exist. Run ` +
              `\`npm run accounts:map\` to see the real names.`,
          );
        }
      }

      await prisma.categoryRule.create({
        data: {
          categoryId: category.id,
          field: rule.field,
          pattern: canonicalPattern(rule.field, rule.pattern),
          accountId,
          direction: rule.direction ?? "ANY",
          priority: rule.priority ?? 100,
          note: rule.note ?? null,
        },
      });

      result.rulesWritten += 1;
    }
  }

  await removeOrphans(prisma, definitions, result);

  return result;
}

/**
 * Deal with categories that used to be defined and no longer are.
 *
 * Unused ones are removed — leaving them would clutter every dropdown Phase 3
 * ever renders. Ones with transactions are reported and left alone, because
 * deleting them would either fail on the foreign key or strand real rows as
 * uncategorised, and neither is a decision a seed script should make on its
 * own.
 */
async function removeOrphans(
  prisma: PrismaClient,
  definitions: readonly CategoryDefinition[],
  result: SeedResult,
): Promise<void> {
  const defined = new Set(definitions.map((d) => `${d.book}::${d.name}`));

  const stored = await prisma.category.findMany({
    include: { _count: { select: { transactions: true } } },
  });

  for (const category of stored) {
    if (defined.has(`${category.book}::${category.name}`)) continue;

    if (category._count.transactions > 0) {
      result.orphanedInUse.push({
        name: category.name,
        book: category.book,
        transactions: category._count.transactions,
      });
      continue;
    }

    await prisma.category.delete({ where: { id: category.id } });
    result.orphanedRemoved.push(`${category.name} (${category.book})`);
  }
}

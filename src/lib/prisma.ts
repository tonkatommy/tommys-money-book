// Prisma client singleton.
//
// Two problems this file solves, both of which bite in ways that are hard to
// diagnose from the error message alone.
//
// 1. Hot reload leaking connections. In dev, Next.js re-runs modules on every
//    file edit. A new PrismaClient per reload would open a new connection pool
//    each time until Postgres hits its connection limit. `globalThis` survives
//    hot reloads, so we stash the client there and reuse it. In production the
//    module loads once and the global is never set.
//
// 2. Build-time evaluation. `next build` imports every page module to work out
//    its configuration — including this one, transitively. There is no
//    database (and no DATABASE_URL) inside a Docker build, so creating the
//    client at import time fails the build with "DATABASE_URL is not set"
//    even though nothing is trying to query anything.
//
//    The fix is to defer creation until the first actual database access. The
//    Proxy below looks unusual, but it means call sites keep the plain
//    `prisma.account.findMany()` shape while construction happens on first
//    use — at request time, when DATABASE_URL genuinely does exist.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env, or check the " +
        "environment passed to this container.",
    );
  }

  // Prisma 7 talks to Postgres through a "driver adapter" — a thin wrapper
  // around the standard `pg` library — instead of the old bundled Rust engine.
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  // Only cache on the global in development, where hot reload is the problem
  // being solved. In production one module load means one client already.
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }

  return client;
}

// In production the lazily-created client is held here rather than on
// globalThis, so repeated access doesn't rebuild it.
let productionClient: PrismaClient | undefined;

function client(): PrismaClient {
  if (process.env.NODE_ENV !== "production") return getClient();
  productionClient ??= getClient();
  return productionClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const real = client();
    const value = Reflect.get(real, property, real);
    // Methods like $queryRaw and $disconnect need `this` to be the real
    // client, not the Proxy, or they lose their internal state.
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/**
 * Close the connection pool, if one was ever opened.
 *
 * Not the same as `prisma.$disconnect()`. Touching the Proxy at all *creates*
 * the client, so a plain disconnect in a `finally` block would construct a
 * connection purely in order to close it — and would throw "DATABASE_URL is
 * not set" in a script that never needed a database (`npm run akahu:probe`
 * only talks to Akahu). Worse, throwing from a `finally` replaces whatever
 * error the script body was already reporting.
 *
 * So: no client, nothing to do; and a teardown failure is logged rather than
 * thrown, because failing to hang up is never the interesting error.
 */
export async function disconnectPrisma(): Promise<void> {
  const existing = globalForPrisma.prisma ?? productionClient;
  if (!existing) return;

  try {
    await existing.$disconnect();
  } catch (err) {
    console.error("[prisma] failed to close the connection pool:", err);
  }
}

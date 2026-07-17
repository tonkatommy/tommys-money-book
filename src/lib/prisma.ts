// Prisma client singleton.
//
// Why the globalThis dance: in dev, Next.js hot-reloads modules on every file
// edit. If each reload created a new PrismaClient, we'd leak database
// connections until Postgres hit its connection limit. `globalThis` survives
// hot reloads, so we stash the client there and reuse it. In production the
// module is only loaded once, so the global is never set.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 talks to Postgres through a "driver adapter" — a thin wrapper
// around the standard `pg` library — instead of the old bundled Rust engine.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Shared plumbing for the CLI scripts.
//
// Every script needs the same three things and gets them wrong in the same
// three ways if each one does it itself:
//
//   - load .env before anything reads process.env (inside Docker there is no
//     .env and the compose environment is already set — dotenv no-ops, which
//     is exactly what we want);
//   - always disconnect Prisma, or the process hangs with an open connection
//     pool and never exits;
//   - exit non-zero on failure, so cron, CI, and `docker compose ps` can all
//     tell a failed run from a successful one.

import "dotenv/config";

import { disconnectPrisma } from "@/lib/prisma";

/** Run a script body with .env loaded, Prisma cleaned up, and a real exit code. */
export async function runScript(
  name: string,
  body: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();

  try {
    await body();
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[${name}] done in ${seconds}s`);
  } catch (err) {
    console.error(`[${name}] failed:`, err);
    process.exitCode = 1;
  } finally {
    // Only closes a pool that was actually opened, and never throws — a script
    // that talks to Akahu and not Postgres must still exit 0.
    await disconnectPrisma();
  }
}

// Reading secrets without letting them leak.
//
// The Akahu tokens grant read access to every connected bank account, so the
// rules are: never in git, never in the database, never in a Docker image
// layer, never in a log line.
//
// Two supported sources, checked in this order:
//
//   1. `${NAME}_FILE` — a path to a file containing the value. This is the
//      convention Docker secrets use: the secret is mounted at
//      /run/secrets/akahu_app_token and the env var points at it. The value
//      never appears in `docker inspect`, in the process environment, or in
//      compose output.
//   2. `${NAME}` — a plain environment variable, loaded from the gitignored
//      .env for local development.
//
// Supporting both now costs almost nothing and means moving to real Docker
// secrets later is a compose-file change, not a code change.

import { readFileSync } from "node:fs";

/** Read a secret, or undefined if neither source is set. */
export function readSecret(name: string): string | undefined {
  const filePath = process.env[`${name}_FILE`]?.trim();

  if (filePath) {
    try {
      const fromFile = readFileSync(filePath, "utf8").trim();
      return fromFile.length > 0 ? fromFile : undefined;
    } catch (err) {
      // Deliberately does not include the file contents in the message.
      throw new Error(
        `${name}_FILE is set to "${filePath}" but could not be read: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  const fromEnv = process.env[name]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/** Read a secret, or fail loudly. Use where the app cannot proceed without it. */
export function requireSecret(name: string): string {
  const value = readSecret(name);
  if (!value) {
    throw new Error(
      `Missing required secret ${name}. Set ${name} in .env (or ${name}_FILE ` +
        `to a file path). See .env.example.`,
    );
  }
  return value;
}

/**
 * Render a secret safe for logging: "app_token_...c4f1".
 *
 * Showing a few characters is genuinely useful — it lets you confirm which
 * token is loaded when a sync fails — without printing enough to be usable.
 */
export function redact(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

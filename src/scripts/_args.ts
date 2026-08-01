// A very small argument parser for the CLI scripts.
//
// Not a dependency, because the whole requirement is `--flag` and
// `--option value`. Anything larger would be more code to read than the
// scripts using it.
//
// One deliberate behaviour: unknown flags are an error rather than being
// ignored. These commands write to real financial data, and a typo'd
// `--dry-run` that silently became a real run is exactly the failure that
// must not be possible.

export type Args = {
  flag(name: string): boolean;
  value(name: string): string | undefined;
  positional: string[];
  /** Call once, after every expected name has been read. */
  rejectUnknown(): void;
};

export function parseArgs(argv: readonly string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = argv[index + 1];

    // `--name value` if the next token isn't itself a flag; `--name` otherwise.
    if (next !== undefined && !next.startsWith("--")) {
      values.set(name, next);
      index += 1;
    } else {
      flags.add(name);
    }
  }

  return {
    flag(name) {
      seen.add(name);
      // `--dry-run false` is a reasonable thing to type, so honour it rather
      // than treating the presence of the name as automatically true.
      const asValue = values.get(name);
      if (asValue !== undefined) return asValue !== "false";
      return flags.has(name);
    },
    value(name) {
      seen.add(name);
      return values.get(name);
    },
    positional,
    rejectUnknown() {
      const unknown = [...flags, ...values.keys()].filter(
        (name) => !seen.has(name),
      );
      if (unknown.length > 0) {
        throw new Error(
          `Unknown option(s): ${unknown.map((n) => `--${n}`).join(", ")}`,
        );
      }
    },
  };
}

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json, so tests import modules
    // by the same specifier the application does.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Only our own tests. Without this, Vitest would also try to run anything
    // test-shaped inside the generated Prisma client.
    include: ["src/**/*.test.ts"],
  },
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests that hit the real database and invoke real server actions
 * (node environment). Kept separate from the fast, DB-free unit suite so
 * `pnpm test` stays hermetic. Run with `pnpm test:integration`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The Next "server-only" marker isn't resolvable outside a Next bundle.
      "server-only": fileURLToPath(new URL("./tests/integration/stubs/server-only.ts", import.meta.url)),
    },
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright end-to-end config.
 *
 * Phase 2 onward adds adversarial security e2e tests (403 on cross-role
 * access, direct server-action rejection, lockout, session timeout).
 * `webServer` is intentionally left out in Phase 0 so `pnpm test:e2e`
 * does not require a running app before any test exists.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

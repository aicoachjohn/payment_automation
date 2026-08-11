import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "./tests/e2e/helpers/env";

/**
 * Playwright end-to-end config (Phase 2 adversarial auth/RBAC suite).
 *
 * Runs a dedicated dev server on port 3100 (so it does not collide with a preview on
 * 3000) with a deterministic dev-only OTP so the 2FA path is testable. `.env` is loaded
 * here so the Prisma-based fixtures and the dev server share the same database.
 */
loadEnv();
process.env.E2E_FIXED_OTP = process.env.E2E_FIXED_OTP ?? "000000";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { E2E_FIXED_OTP: process.env.E2E_FIXED_OTP },
  },
});

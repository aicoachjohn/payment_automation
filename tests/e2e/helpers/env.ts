import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Minimal .env loader (Playwright does not auto-load .env). Idempotent. */
export function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional in CI where env is provided directly.
  }

  // Tests never call Google. .env carries the live mirror settings for the dev server, and
  // without this every runDailyAutomation() in the suite would make a real Sheets request —
  // slow, flaky, and writing this machine's test data into the business's spreadsheet.
  // A suite that needs the queue mocks @/server/sheets instead.
  process.env.SHEETS_PROVIDER = "noop";
}

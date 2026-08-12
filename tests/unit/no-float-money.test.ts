// @vitest-environment node
/**
 * FR-REC-07 / Phase-11 verify #4 — the codebase never does floating-point arithmetic on
 * money. All money is exact Decimal and every calculation goes through src/server/money.
 * This test greps the production source and asserts ZERO hits of:
 *   - `parseFloat` (never needed for money), and
 *   - `Number(<money identifier>)` — coercing a money value to a JS float —
 * anywhere outside src/server/money (the one sanctioned home for money arithmetic).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src");
// The one place money arithmetic lives; date/number formatters are not money math.
const EXCLUDE = ["/server/money/", "/lib/ist.ts", "/lib/format.ts"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const FILES = walk(ROOT).filter((f) => !EXCLUDE.some((e) => f.replace(/\\/g, "/").includes(e)));

// `Number(...money...)` — a money identifier being coerced to a JS float.
const MONEY_NUMBER = /Number\(\s*[A-Za-z0-9_.$?\[\]'"]*(?:amount|Amount|fee|Fee|balance|Balance|received|Received|concession|Concession|outstanding|Outstanding|paise|Paise)/;

describe("FR-REC-07 — no floating-point arithmetic on money outside src/server/money", () => {
  it("no `parseFloat` in production source", () => {
    const hits = FILES.filter((f) => /parseFloat/.test(readFileSync(f, "utf8"))).map((f) => f.replace(ROOT, "src"));
    expect(hits, `parseFloat found in: ${hits.join(", ")}`).toEqual([]);
  });

  it("no `Number(<money>)` coercion in production source", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (MONEY_NUMBER.test(line)) hits.push(`${f.replace(ROOT, "src")}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(hits, `money coerced to float:\n${hits.join("\n")}`).toEqual([]);
  });

  it("scanned a meaningful number of files (guard against an empty scan)", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });
});

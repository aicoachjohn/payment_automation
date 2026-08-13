// @vitest-environment node
/**
 * NFR-16 / BR-13 — NO business parameter is hard-coded. Prices come from the Pricing
 * Master (DB), GST and every threshold/window from SystemConfig. This test proves the
 * calculation layer (`src/server/services`) carries no brochure-price or GST literal, and
 * that the tunable parameters are read through the config accessors — so changing any of
 * them is a config edit, never a code change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SERVICES = join(process.cwd(), "src/server/services");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
  }
  return out;
}
// draft-template holds the customer-message DEFAULTS (bank A/C, MICR) that are SystemConfig-
// backed and overridable — not calculation parameters — so it is out of scope for prices.
const FILES = walk(SERVICES).filter((f) => !f.endsWith("draft-template.ts"));

// A plain 5+ digit run NOT part of an underscore-separated numeric (time/security constants
// like 60_000, 86_400_000 use underscores; brochure prices like 24999 do not).
const PRICE_LITERAL = /(?<![\d_])[1-9]\d{4,}(?![\d_])/;

describe("NFR-16 — no hard-coded business parameters in the calculation layer", () => {
  it("no brochure-price literal (5+ digit) appears in src/server/services", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (PRICE_LITERAL.test(line)) hits.push(`${f.replace(SERVICES, "services")}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(hits, `price-like literals in the calc layer:\n${hits.join("\n")}`).toEqual([]);
  });

  it("no GST rate literal (0.18 / 1.18 / *18) in the calculation layer — GST is config", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      if (/\b0\.18\b|\b1\.18\b|\*\s*18\b|\/\s*1\.18\b/.test(src)) hits.push(f.replace(SERVICES, "services"));
    }
    expect(hits, `GST literal in: ${hits.join(", ")}`).toEqual([]);
  });

  it("the tunable business parameters are read through the config accessors", () => {
    const all = FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const key of ["gst_percent", "down_payment_window_days", "reminder_days", "audit_ageing_threshold_hours", "duplicate_payment_window_hours"]) {
      expect(all, `config key ${key} must be read from SystemConfig`).toContain(key);
    }
  });
});

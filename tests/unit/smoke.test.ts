import { describe, expect, it } from "vitest";

/**
 * Phase 0 smoke test — proves the Vitest toolchain runs.
 * Real unit suites (money, audit, permission matrix, fee engine) arrive
 * in Phases 1–3.
 */
describe("toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});

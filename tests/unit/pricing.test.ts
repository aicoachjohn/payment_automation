import { describe, expect, it } from "vitest";
import {
  Program,
  Plan,
  ComboMode,
  ConcessionStatus,
  ConcessionThresholdType,
  type PricingMaster,
} from "@prisma/client";
import {
  resolveStandardFee,
  applyConcession,
  buildPaymentSchedule,
  draftBlockers,
  PricingError,
} from "@/server/services/pricing-core";
import { money } from "@/server/money";

const f2 = (v: { toFixed(n: number): string }) => v.toFixed(2);

// Minimal Pricing Master rows (only the fee fields the resolver reads).
function row(partial: Partial<PricingMaster>): PricingMaster {
  return { gstPercent: money("18"), ...partial } as unknown as PricingMaster;
}

const STANDARD: Partial<Record<Program, PricingMaster>> = {
  [Program.DATA_ANALYST]: row({ advancedFee: money("24999"), premiumFee: money("74999") }),
  [Program.ADV_DATA_SCIENCE_AI]: row({ advancedFee: money("29999"), premiumFee: money("79999") }),
  [Program.AGENTIC_AI_GENAI]: row({ advancedFee: money("34999"), premiumFee: money("89999") }),
};
const COMBO: Record<Plan, PricingMaster> = {
  [Plan.ADVANCED]: row({ doubleShotFee: money("34999"), singleShotFee: money("31999") }),
  [Plan.PREMIUM]: row({ doubleShotFee: money("89999"), singleShotFee: money("84999") }),
};

describe("resolveStandardFee — all 6 standard + 4 combo cells (FRD 5.4.1/5.4.2)", () => {
  const standardCases: [Program, Plan, string][] = [
    [Program.DATA_ANALYST, Plan.ADVANCED, "24999.00"],
    [Program.DATA_ANALYST, Plan.PREMIUM, "74999.00"],
    [Program.ADV_DATA_SCIENCE_AI, Plan.ADVANCED, "29999.00"],
    [Program.ADV_DATA_SCIENCE_AI, Plan.PREMIUM, "79999.00"],
    [Program.AGENTIC_AI_GENAI, Plan.ADVANCED, "34999.00"],
    [Program.AGENTIC_AI_GENAI, Plan.PREMIUM, "89999.00"],
  ];
  for (const [program, plan, expected] of standardCases) {
    it(`${program}/${plan} → ₹${expected}`, () => {
      expect(f2(resolveStandardFee(STANDARD[program]!, program, plan))).toBe(expected);
    });
  }

  const comboCases: [Plan, ComboMode, string][] = [
    [Plan.ADVANCED, ComboMode.DOUBLE_SHOT, "34999.00"],
    [Plan.ADVANCED, ComboMode.SINGLE_SHOT, "31999.00"],
    [Plan.PREMIUM, ComboMode.DOUBLE_SHOT, "89999.00"],
    [Plan.PREMIUM, ComboMode.SINGLE_SHOT, "84999.00"],
  ];
  for (const [plan, mode, expected] of comboCases) {
    it(`COMBO/${plan}/${mode} → ₹${expected}`, () => {
      expect(f2(resolveStandardFee(COMBO[plan], Program.COMBO_ALL_THREE, plan, mode))).toBe(expected);
    });
  }

  it("combo without a mode is rejected (FR-SAL-16)", () => {
    expect(() => resolveStandardFee(COMBO[Plan.ADVANCED], Program.COMBO_ALL_THREE, Plan.ADVANCED)).toThrow(PricingError);
  });
});

describe("applyConcession — value & percentage, threshold (FR-SAL-26/27)", () => {
  const threshold = { amount: 2000, percent: 10 }; // min(₹2000, 10%) — Q-02 placeholder

  it("no concession → NONE, full fee", () => {
    const r = applyConcession({ standardFee: "24999", concessionValue: "0", concessionType: ConcessionThresholdType.AMOUNT, threshold });
    expect(r.concessionStatus).toBe(ConcessionStatus.NONE);
    expect(f2(r.finalApprovedFee)).toBe("24999.00");
    expect(f2(r.thresholdValue)).toBe("2000.00"); // min(2000, 2499.90)
  });

  it("value at threshold → AUTO_APPROVED", () => {
    const r = applyConcession({ standardFee: "24999", concessionValue: "2000", concessionType: ConcessionThresholdType.AMOUNT, threshold });
    expect(r.concessionStatus).toBe(ConcessionStatus.AUTO_APPROVED);
    expect(r.requiresApproval).toBe(false);
    expect(f2(r.finalApprovedFee)).toBe("22999.00");
  });

  it("value above threshold → PENDING_APPROVAL", () => {
    const r = applyConcession({ standardFee: "24999", concessionValue: "2500", concessionType: ConcessionThresholdType.AMOUNT, threshold });
    expect(r.concessionStatus).toBe(ConcessionStatus.PENDING_APPROVAL);
    expect(r.requiresApproval).toBe(true);
    expect(f2(r.finalApprovedFee)).toBe("22499.00");
  });

  it("percentage below threshold → AUTO_APPROVED", () => {
    const r = applyConcession({ standardFee: "24999", concessionValue: "5", concessionType: ConcessionThresholdType.PERCENTAGE, threshold });
    expect(f2(r.concessionAmount)).toBe("1249.95"); // 5% of 24999
    expect(r.concessionStatus).toBe(ConcessionStatus.AUTO_APPROVED);
    expect(f2(r.finalApprovedFee)).toBe("23749.05");
  });

  it("percentage above threshold → PENDING_APPROVAL", () => {
    const r = applyConcession({ standardFee: "24999", concessionValue: "15", concessionType: ConcessionThresholdType.PERCENTAGE, threshold });
    expect(f2(r.concessionAmount)).toBe("3749.85"); // 15% of 24999
    expect(r.concessionStatus).toBe(ConcessionStatus.PENDING_APPROVAL);
  });

  it("the PERCENT cap can be the binding limit (whichever is lower)", () => {
    // amount cap high, percent cap low → percent wins: min(20000, 5% of 24999=1249.95)
    const r = applyConcession({ standardFee: "24999", concessionValue: "1500", concessionType: ConcessionThresholdType.AMOUNT, threshold: { amount: 20000, percent: 5 } });
    expect(f2(r.thresholdValue)).toBe("1249.95");
    expect(r.requiresApproval).toBe(true);
  });

  it("a concession cannot reduce the fee to zero or below", () => {
    expect(() => applyConcession({ standardFee: "24999", concessionValue: "24999", concessionType: ConcessionThresholdType.AMOUNT, threshold })).toThrow(PricingError);
  });
});

describe("draftBlockers (FR-SAL-27)", () => {
  it("blocks while a concession is PENDING_APPROVAL", () => {
    expect(draftBlockers({ concessionStatus: ConcessionStatus.PENDING_APPROVAL, finalApprovedFee: money("22499") })).toHaveLength(1);
  });
  it("allows once AUTO_APPROVED", () => {
    expect(draftBlockers({ concessionStatus: ConcessionStatus.AUTO_APPROVED, finalApprovedFee: money("22499") })).toHaveLength(0);
  });
});

describe("buildPaymentSchedule — instalments always sum EXACTLY to the fee", () => {
  const start = new Date("2026-08-12T00:00:00Z");

  it("default 40/40/20 on 24999", () => {
    const s = buildPaymentSchedule({ finalApprovedFee: "24999", startDate: start, splits: [40, 40, 20] });
    expect(s.map((i) => f2(i.amount))).toEqual(["9999.60", "9999.60", "4999.80"]);
    expect(f2(money(s.reduce((t, i) => t + Number(i.amount.toFixed(2)), 0)))).toBe("24999.00");
  });

  it("double-shot 50/50 on 89999", () => {
    const s = buildPaymentSchedule({ finalApprovedFee: "89999", startDate: start, splits: [50, 50] });
    expect(s.map((i) => f2(i.amount))).toEqual(["44999.50", "44999.50"]);
  });

  it("single-shot 100 on 84999", () => {
    const s = buildPaymentSchedule({ finalApprovedFee: "84999", startDate: start, splits: [100] });
    expect(s).toHaveLength(1);
    expect(f2(s[0].amount)).toBe("84999.00");
  });

  it("rounding remainder lands on the LAST instalment and total stays exact", () => {
    const s = buildPaymentSchedule({ finalApprovedFee: "33.33", startDate: start, splits: [50, 50] });
    expect(s.map((i) => f2(i.amount))).toEqual(["16.67", "16.66"]); // 16.665→16.67, remainder 16.66
    const total = s.reduce((t, i) => t.plus(i.amount), money(0));
    expect(f2(total)).toBe("33.33");
  });

  it("custom schedule must sum to the fee or it fails loudly", () => {
    expect(() =>
      buildPaymentSchedule({ finalApprovedFee: "1000", startDate: start, custom: [{ amount: "400", dueDate: start }, { amount: "500", dueDate: start }] }),
    ).toThrow(PricingError);
  });
});

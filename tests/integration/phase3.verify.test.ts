// @vitest-environment node
/**
 * Phase 3 verification — the five checks from the build pack, each proven with a real
 * command/assertion (not a claim):
 *   1. Every program+plan+combo → base/gst/standard, matching FRD 5.4.1/5.4.2 exactly.
 *   2. Lock a lead, change the Pricing Master → locked lead unchanged; a new lead gets
 *      the new price.
 *   3. A hand-typed fee is rejected (the fee API accepts SELECTIONS ONLY).
 *   4. A concession above the threshold BLOCKS draft/fee-lock until approved.
 *   5. Every instalment schedule sums EXACTLY to the final approved fee.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, Program, Plan, ComboMode, ConcessionThresholdType, ConcessionStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { calculateFee, lockFee, applyConcession, buildPaymentSchedule, getConcessionThreshold } =
  await import("@/server/services/pricing");
const { updatePricing } = await import("@/server/services/pricing-admin");
const { feeCalcSchema } = await import("@/lib/schemas");

const prisma = new PrismaClient();
const f2 = (v: { toFixed(n: number): string }) => v.toFixed(2);
let adminId: string;
let salesId: string;

async function reseedPricing(createdBy: string) {
  // Clear verify enrollments/leads first — they reference pricing rows (FK RESTRICT).
  await prisma.enrollment.deleteMany({ where: { lead: { remarks: "phase3-verify" } } });
  await prisma.lead.deleteMany({ where: { remarks: "phase3-verify" } });
  await prisma.pricingMaster.deleteMany({});
  const now = new Date();
  await prisma.pricingMaster.createMany({
    data: [
      { program: Program.DATA_ANALYST, advancedFee: "24999", premiumFee: "74999", gstPercent: "18", effectiveFrom: now, createdBy },
      { program: Program.ADV_DATA_SCIENCE_AI, advancedFee: "29999", premiumFee: "79999", gstPercent: "18", effectiveFrom: now, createdBy },
      { program: Program.AGENTIC_AI_GENAI, advancedFee: "34999", premiumFee: "89999", gstPercent: "18", effectiveFrom: now, createdBy },
      { program: Program.COMBO_ALL_THREE, plan: Plan.ADVANCED, doubleShotFee: "34999", singleShotFee: "31999", gstPercent: "18", effectiveFrom: now, createdBy },
      { program: Program.COMBO_ALL_THREE, plan: Plan.PREMIUM, doubleShotFee: "89999", singleShotFee: "84999", gstPercent: "18", effectiveFrom: now, createdBy },
    ],
  });
}

beforeAll(async () => {
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: Role.SUPER_ADMIN } })).id;
  salesId = (await prisma.user.findFirstOrThrow({ where: { role: Role.SALESPERSON } })).id;
  await reseedPricing(adminId);
});
afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { lead: { remarks: "phase3-verify" } } });
  await prisma.lead.deleteMany({ where: { remarks: "phase3-verify" } });
  await reseedPricing(adminId);
  await prisma.$disconnect();
});

describe("#1 — every program+plan+combo matches FRD 5.4.1/5.4.2, base+gst reconciles", () => {
  const CASES: { program: Program; plan: Plan; combo?: ComboMode; expected: string }[] = [
    { program: Program.DATA_ANALYST, plan: Plan.ADVANCED, expected: "24999.00" },
    { program: Program.DATA_ANALYST, plan: Plan.PREMIUM, expected: "74999.00" },
    { program: Program.ADV_DATA_SCIENCE_AI, plan: Plan.ADVANCED, expected: "29999.00" },
    { program: Program.ADV_DATA_SCIENCE_AI, plan: Plan.PREMIUM, expected: "79999.00" },
    { program: Program.AGENTIC_AI_GENAI, plan: Plan.ADVANCED, expected: "34999.00" },
    { program: Program.AGENTIC_AI_GENAI, plan: Plan.PREMIUM, expected: "89999.00" },
    { program: Program.COMBO_ALL_THREE, plan: Plan.ADVANCED, combo: ComboMode.DOUBLE_SHOT, expected: "34999.00" },
    { program: Program.COMBO_ALL_THREE, plan: Plan.ADVANCED, combo: ComboMode.SINGLE_SHOT, expected: "31999.00" },
    { program: Program.COMBO_ALL_THREE, plan: Plan.PREMIUM, combo: ComboMode.DOUBLE_SHOT, expected: "89999.00" },
    { program: Program.COMBO_ALL_THREE, plan: Plan.PREMIUM, combo: ComboMode.SINGLE_SHOT, expected: "84999.00" },
  ];

  it("prints the full fee table and asserts each figure", async () => {
    console.log("\n  Program                Plan      Combo         Base        GST      Standard");
    console.log("  " + "─".repeat(78));
    for (const c of CASES) {
      const q = await calculateFee({ program: c.program, plan: c.plan, comboMode: c.combo ?? null });
      const label = `${c.program.padEnd(20)} ${c.plan.padEnd(9)} ${(c.combo ?? "—").padEnd(12)}`;
      console.log(`  ${label} ${f2(q.baseFee).padStart(10)} ${f2(q.gstAmount).padStart(10)} ${f2(q.standardFee).padStart(11)}`);
      expect(f2(q.standardFee)).toBe(c.expected); // matches FRD inclusive figure
      expect(f2(q.baseFee.plus(q.gstAmount))).toBe(c.expected); // base + gst reconciles
    }
  });
});

describe("#2 — a locked lead keeps its price; a new lead gets the new price", () => {
  it("lock at 24999, raise the price, prove immutability + new price for new leads", async () => {
    await reseedPricing(adminId);
    const lead = await prisma.lead.create({ data: { fullName: "P3 Verify", salespersonId: salesId, remarks: "phase3-verify" } });
    const enr = await prisma.enrollment.create({ data: { leadId: lead.id, program: Program.DATA_ANALYST, plan: Plan.ADVANCED, concessionStatus: ConcessionStatus.NONE } });

    await lockFee(enr.id, { userId: salesId, role: Role.SALESPERSON });
    const locked = await prisma.enrollment.findUniqueOrThrow({ where: { id: enr.id } });
    expect(f2(locked.finalApprovedFee!)).toBe("24999.00");

    const rowId = (await prisma.pricingMaster.findFirstOrThrow({ where: { program: Program.DATA_ANALYST, plan: null, effectiveTo: null } })).id;
    await updatePricing({ userId: adminId, role: Role.SUPER_ADMIN }, rowId, {
      program: Program.DATA_ANALYST, advancedFee: "27999", premiumFee: "77999",
      effectiveFrom: new Date(Date.now() + 1000).toISOString(),
    });

    const still = await prisma.enrollment.findUniqueOrThrow({ where: { id: enr.id } });
    expect(f2(still.finalApprovedFee!)).toBe("24999.00"); // locked lead unchanged
    const q = await calculateFee({ program: Program.DATA_ANALYST, plan: Plan.ADVANCED, asOfDate: new Date(Date.now() + 5000) });
    expect(f2(q.standardFee)).toBe("27999.00"); // new lead gets the new price
    console.log(`\n  Locked lead: ₹${f2(still.finalApprovedFee!)}  |  New lead now: ₹${f2(q.standardFee)}`);
  });
});

describe("#3 — the fee API accepts SELECTIONS ONLY (hand-typed fee rejected)", () => {
  it("rejects an extra `fee` key and accepts a bare selection", () => {
    const withFee = feeCalcSchema.safeParse({ program: "DATA_ANALYST", plan: "ADVANCED", fee: "999" });
    expect(withFee.success).toBe(false);
    const withStandard = feeCalcSchema.safeParse({ program: "DATA_ANALYST", plan: "ADVANCED", standardFee: "1" });
    expect(withStandard.success).toBe(false);
    const ok = feeCalcSchema.safeParse({ program: "DATA_ANALYST", plan: "ADVANCED" });
    expect(ok.success).toBe(true);
    console.log(`\n  {program,plan,fee:999} → rejected: ${!withFee.success}  |  {program,plan} → accepted: ${ok.success}`);
  });
});

describe("#4 — a concession above the threshold blocks fee-lock until approved", () => {
  it("PENDING concession blocks lockFee; once approved it succeeds", async () => {
    await reseedPricing(adminId);
    const threshold = await getConcessionThreshold(Plan.ADVANCED);
    // 2500 on a 24999 advanced fee is above min(₹2000, 10%) → PENDING_APPROVAL.
    const c = applyConcession({ standardFee: "24999", concessionValue: "2500", concessionType: ConcessionThresholdType.AMOUNT, threshold });
    expect(c.concessionStatus).toBe(ConcessionStatus.PENDING_APPROVAL);

    const lead = await prisma.lead.create({ data: { fullName: "P3 Concession", salespersonId: salesId, remarks: "phase3-verify" } });
    const enr = await prisma.enrollment.create({
      data: { leadId: lead.id, program: Program.DATA_ANALYST, plan: Plan.ADVANCED, concessionAmount: c.concessionAmount.toFixed(2), concessionStatus: ConcessionStatus.PENDING_APPROVAL, concessionReason: "Loyalty" },
    });

    await expect(lockFee(enr.id, { userId: salesId, role: Role.SALESPERSON })).rejects.toThrow(/approval/i);

    // Manager/Admin approves → status becomes APPROVED (not pending); lock now succeeds.
    await prisma.enrollment.update({ where: { id: enr.id }, data: { concessionStatus: ConcessionStatus.APPROVED } });
    await lockFee(enr.id, { userId: salesId, role: Role.SALESPERSON });
    const locked = await prisma.enrollment.findUniqueOrThrow({ where: { id: enr.id } });
    expect(f2(locked.finalApprovedFee!)).toBe("22499.00");
    console.log(`\n  Above-threshold concession blocked lock; after approval final = ₹${f2(locked.finalApprovedFee!)}`);
  });
});

describe("#5 — every instalment schedule sums EXACTLY to the final approved fee", () => {
  const start = new Date("2026-08-12T00:00:00Z");
  const CASES: { fee: string; splits: number[] }[] = [
    { fee: "24999", splits: [40, 40, 20] },
    { fee: "89999", splits: [50, 50] },
    { fee: "84999", splits: [100] },
    { fee: "23749.05", splits: [40, 40, 20] },
    { fee: "33.33", splits: [50, 50] },
  ];
  it("sums are exact across default/double/single/concession/rounding-drift cases", () => {
    for (const c of CASES) {
      const s = buildPaymentSchedule({ finalApprovedFee: c.fee, startDate: start, splits: c.splits });
      // Exact Decimal sum (no float): reduce the instalment Decimals together.
      const total = s.slice(1).reduce((acc, i) => acc.plus(i.amount), s[0].amount);
      console.log(`\n  ₹${c.fee} split ${c.splits.join("/")} → [${s.map((i) => i.amount.toFixed(2)).join(", ")}] sum ${total.toFixed(2)}`);
      expect(total.toFixed(2)).toBe(Number(c.fee).toFixed(2));
    }
  });
});

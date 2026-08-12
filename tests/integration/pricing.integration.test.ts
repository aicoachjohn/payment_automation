// @vitest-environment node
/**
 * Phase 3 — DB-backed pricing engine: effective-dating, locked-fee immutability
 * (FR-ADM-02/03, FR-SAL-23), the "old lead keeps its price" case, and admin auditing.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, Program, Plan, ConcessionStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { calculateFee, lockFee, unlockFee } = await import("@/server/services/pricing");
const { createPricing, updatePricing, setConcessionThreshold, getConcessionThresholdConfig } =
  await import("@/server/services/pricing-admin");
const { getConcessionThreshold } = await import("@/server/services/pricing");

const prisma = new PrismaClient();
const f2 = (v: { toFixed(n: number): string }) => v.toFixed(2);

let adminActor: { userId: string; role: Role };
let salesActor: { userId: string; role: Role };
let leadId: string;
let enrollmentId: string;

async function reseedPricing(createdBy: string) {
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
  const admin = await prisma.user.findFirstOrThrow({ where: { role: Role.SUPER_ADMIN } });
  const sales = await prisma.user.findFirstOrThrow({ where: { role: Role.SALESPERSON } });
  adminActor = { userId: admin.id, role: Role.SUPER_ADMIN };
  salesActor = { userId: sales.id, role: Role.SALESPERSON };
  await reseedPricing(admin.id);

  const lead = await prisma.lead.create({ data: { fullName: "Pricing Test", salespersonId: sales.id } });
  leadId = lead.id;
  const enrollment = await prisma.enrollment.create({
    data: { leadId: lead.id, program: Program.DATA_ANALYST, plan: Plan.ADVANCED, concessionStatus: ConcessionStatus.NONE },
  });
  enrollmentId = enrollment.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { enrollmentId } });
  await prisma.enrollment.deleteMany({ where: { id: enrollmentId } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
  await reseedPricing(adminActor.userId); // leave pricing in the canonical seeded state
  await prisma.$disconnect();
});

describe("calculateFee resolves the effective brochure price", () => {
  it("standard DATA_ANALYST/ADVANCED = ₹24999 inclusive (base+gst reconcile)", async () => {
    const q = await calculateFee({ program: Program.DATA_ANALYST, plan: Plan.ADVANCED });
    expect(f2(q.standardFee)).toBe("24999.00");
    expect(f2(q.baseFee)).toBe("21185.59");
    expect(f2(q.gstAmount)).toBe("3813.41");
  });
});

describe("effective-dating (FR-ADM-02) — the rate at the as-of date applies", () => {
  it("a price change is effective-dated; the old date still yields the old price", async () => {
    const before = new Date();
    // A brand-new effective row from `now` supersedes the seeded one.
    const effectiveFrom = new Date(Date.now() + 1000).toISOString();
    await updatePricing(adminActor, (await currentStandardRowId()), {
      program: Program.DATA_ANALYST, advancedFee: "26999", premiumFee: "76999", effectiveFrom,
    });

    const nowQuote = await calculateFee({ program: Program.DATA_ANALYST, plan: Plan.ADVANCED, asOfDate: new Date(Date.now() + 5000) });
    expect(f2(nowQuote.standardFee)).toBe("26999.00"); // new lead gets the new price

    const pastQuote = await calculateFee({ program: Program.DATA_ANALYST, plan: Plan.ADVANCED, asOfDate: before });
    expect(f2(pastQuote.standardFee)).toBe("24999.00"); // historical date → old price
  });
});

describe("locked fee is immutable to later Pricing Master changes (FR-ADM-03/FR-SAL-23)", () => {
  it("lock at 24999, change price, locked lead unchanged while a new lead gets the new price", async () => {
    await reseedPricing(adminActor.userId); // reset to 24999 baseline
    await lockFee(enrollmentId, salesActor);

    const locked = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(f2(locked.finalApprovedFee!)).toBe("24999.00");
    expect(locked.feeLockedAt).not.toBeNull();

    // Change the price after the lock.
    await updatePricing(adminActor, (await currentStandardRowId()), {
      program: Program.DATA_ANALYST, advancedFee: "27999", premiumFee: "77999",
      effectiveFrom: new Date(Date.now() + 1000).toISOString(),
    });

    const stillLocked = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(f2(stillLocked.finalApprovedFee!)).toBe("24999.00"); // unchanged

    const newLeadQuote = await calculateFee({ program: Program.DATA_ANALYST, plan: Plan.ADVANCED, asOfDate: new Date(Date.now() + 5000) });
    expect(f2(newLeadQuote.standardFee)).toBe("27999.00"); // new lead gets new price
  });

  it("re-locking a locked fee is refused", async () => {
    await expect(lockFee(enrollmentId, salesActor)).rejects.toThrow(/already locked/i);
  });

  it("a salesperson cannot unlock a fee (needs fee:unlock)", async () => {
    await expect(unlockFee(enrollmentId, salesActor, "trying")).rejects.toThrow(/permission/i);
  });

  it("unlock requires a reason and, given one, returns the lead to DRAFT", async () => {
    await expect(unlockFee(enrollmentId, adminActor, "")).rejects.toThrow(/reason/i);
    await unlockFee(enrollmentId, adminActor, "Correcting the wrong plan");
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(e.feeLockedAt).toBeNull();
    expect(e.enrollmentStatus).toBe("DRAFT");
  });
});

describe("admin config is audited (FR-ADM-04/05)", () => {
  it("createPricing writes an audit entry", async () => {
    const { id } = await createPricing(adminActor, {
      program: Program.DATA_ANALYST, advancedFee: "25999", premiumFee: "75999",
      effectiveFrom: new Date(Date.now() + 2000).toISOString(),
    });
    const audits = await prisma.auditTrail.count({ where: { entityType: "PricingMaster", entityId: id, action: "CREATE" } });
    expect(audits).toBeGreaterThanOrEqual(1);
  });

  it("setConcessionThreshold persists per plan and is audited", async () => {
    await setConcessionThreshold(adminActor, Plan.ADVANCED, { amount: 1500, percent: 8 });
    const t = await getConcessionThreshold(Plan.ADVANCED);
    expect(t).toEqual({ amount: 1500, percent: 8 });
    const audits = await prisma.auditTrail.count({ where: { entityType: "SystemConfig", entityId: "concession_threshold" } });
    expect(audits).toBeGreaterThanOrEqual(1);
    // restore
    await setConcessionThreshold(adminActor, Plan.ADVANCED, { amount: 2000, percent: 10 });
    await getConcessionThresholdConfig();
  });
});

/** The id of the currently-effective standard DATA_ANALYST row. */
async function currentStandardRowId(): Promise<string> {
  const row = await prisma.pricingMaster.findFirstOrThrow({
    where: { program: Program.DATA_ANALYST, plan: null, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
  });
  return row.id;
}

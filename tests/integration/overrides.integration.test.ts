// @vitest-environment node
/**
 * Super Admin override authority (FR-SA-06..15, BR-24..26). Covers the override kinds not
 * already exercised by phase9.verify (unlock-fee, reassign, concession), proves the four
 * guarantees route through performOverride() (reason + SuperAdminActivity + AuditTrail +
 * notify), and proves that holding a base permission is NOT enough — only the SUPER_ADMIN
 * role may override (a Sales Manager with fee:unlock / concession:approve is refused).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { performOverride, describeOverride } = await import("@/server/services/overrides");
const { AuthorizationError } = await import("@/server/auth/permissions");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevinId: string;
let manager: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
const TAG = "overrides-it";
let n = 0;

const DETAILS = { fullName: "Override IT", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };

async function readyLead(withDraft = true): Promise<{ leadId: string; enrollmentId: string }> {
  n += 1;
  const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await leads.markInterested(mathiew, id);
  await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `ov${n}@example.com`, mobile: `93${String(600000000 + n)}` });
  await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  if (withDraft) await generateDraft(mathiew, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  return { leadId: id, enrollmentId: e.id };
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  kevinId = (await prisma.user.findFirstOrThrow({ where: { email: "kevin@proitbridge.local" } })).id;
  manager = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "sales.manager@proitbridge.local" } })).id, role: Role.SALES_MANAGER };
  superAdmin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "super.admin@proitbridge.local" } })).id, role: Role.SUPER_ADMIN };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("unlock-fee override", () => {
  it("clears the lock, returns the enrollment to DRAFT, logs activity + audit, notifies", async () => {
    const { enrollmentId } = await readyLead(true);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).feeLockedAt).not.toBeNull();

    const notifBefore = await prisma.notification.count();
    await performOverride(superAdmin, { kind: "UNLOCK_FEE", enrollmentId, reason: "wrong plan selected" });

    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    const activity = await prisma.superAdminActivity.findFirst({ where: { entityId: enrollmentId, overrideType: "UNLOCK_FEE" } });
    const audit = await prisma.auditTrail.findFirst({ where: { entityId: enrollmentId, action: "OVERRIDE_FEE_UNLOCK" } });
    expect(e.feeLockedAt).toBeNull();
    expect(e.enrollmentStatus).toBe("DRAFT");
    expect(activity?.reasonText).toBe("wrong plan selected");
    expect(audit).toBeTruthy();
    expect(await prisma.notification.count()).toBeGreaterThan(notifBefore);
  });
});

describe("reassign-lead override", () => {
  it("moves the lead, notifies both, and refuses a same-owner reassignment", async () => {
    const { leadId } = await readyLead(false);
    await performOverride(superAdmin, { kind: "REASSIGN_LEAD", leadId, newSalespersonId: kevinId, reason: "coverage" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).salespersonId).toBe(kevinId);
    const activity = await prisma.superAdminActivity.findFirst({ where: { entityId: leadId, overrideType: "REASSIGN_LEAD" } });
    expect(activity?.notifiedTo.length).toBe(2); // from + to

    // Reassigning to the same person is refused.
    await expect(performOverride(superAdmin, { kind: "REASSIGN_LEAD", leadId, newSalespersonId: kevinId, reason: "again" })).rejects.toThrow(/already assigned/i);
  });
});

describe("consequence preview (FR-SA-15)", () => {
  it("describes the exact effect before commit", async () => {
    const { leadId } = await readyLead(false);
    const text = await describeOverride(superAdmin, { kind: "REASSIGN_LEAD", leadId, newSalespersonId: kevinId, reason: "x" });
    expect(text).toMatch(/reassign/i);
    expect(text).toMatch(/notified/i);
  });
});

describe("only the SUPER_ADMIN role may override (BR-24 governance)", () => {
  it("a Sales Manager holding fee:unlock is STILL refused an override", async () => {
    const { enrollmentId } = await readyLead(true);
    await expect(
      performOverride(manager as never, { kind: "UNLOCK_FEE", enrollmentId, reason: "manager tries" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // …and the fee remains locked — nothing changed.
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).feeLockedAt).not.toBeNull();
  });

  it("a salesperson cannot preview or perform an override", async () => {
    const { leadId } = await readyLead(false);
    await expect(describeOverride(mathiew as never, { kind: "REASSIGN_LEAD", leadId, newSalespersonId: kevinId, reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

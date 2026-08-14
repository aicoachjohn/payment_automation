// @vitest-environment node
/**
 * "Delete" a lead = VOID (soft delete, BR-21/BR-26): hidden from lists, kept in history with a
 * reason + audit. Own-lead only; blocked when an approved payment exists; pending payments are
 * voided too. Verifies each rule. No hard delete anywhere.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, Program, Plan, PaymentType, PaymentMethod, AuditStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const leads = await import("@/server/services/leads");
const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevin: { userId: string; role: Role };
const TAG = "void-lead-it";
let n = 0;

async function newLead(actor = mathiew): Promise<string> {
  n += 1;
  const { id } = await leads.createLead(actor, { fullName: `Void Test ${n}`, email: `void${n}@example.com`, mobile: `98${String(70000000 + n)}`, leadSource: TAG });
  return id;
}
async function addPayment(leadId: string, status: AuditStatus): Promise<void> {
  const e = await prisma.enrollment.create({ data: { leadId, program: Program.DATA_ANALYST, plan: Plan.ADVANCED } });
  await prisma.payment.create({
    data: {
      enrollmentId: e.id, paymentNumber: 1, paymentType: PaymentType.COURSE_HOLDING,
      expectedAmount: "1000", receivedAmount: "1000", paymentDate: new Date(), paymentMethod: PaymentMethod.UPI,
      transactionId: `VOIDIT-${TAG}-${n}`, auditStatus: status, submittedBy: mathiew.userId, submittedAt: new Date(),
    },
  });
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.enrollment.deleteMany({ where: { id: { in: eids } } });
  }
  await prisma.lead.deleteMany({ where: { id: { in: rows.map((l) => l.id) } } });
}

beforeAll(async () => {
  const u = async (email: string, role: Role) => ({ userId: (await prisma.user.findFirstOrThrow({ where: { email } })).id, role });
  mathiew = await u("mathiew@proitbridge.local", Role.SALESPERSON);
  kevin = await u("kevin@proitbridge.local", Role.SALESPERSON);
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("voidLead (soft delete)", () => {
  it("voids a plain lead with a reason — hidden from lists, kept in history + audited", async () => {
    const id = await newLead();
    await leads.voidLead(mathiew, id, "duplicate entry");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.voided).toBe(true);
    expect(lead.voidedReason).toBe("duplicate entry");
    // excluded from the salesperson's active list
    const list = await leads.listLeads(mathiew, {});
    expect(list.find((l) => l.id === id)).toBeUndefined();
    // append-only audit records the VOID
    const audit = await prisma.auditTrail.findFirst({ where: { entityId: id, action: "VOID" } });
    expect(audit).not.toBeNull();
  });

  it("requires a reason", async () => {
    const id = await newLead();
    await expect(leads.voidLead(mathiew, id, "  ")).rejects.toThrow();
  });

  it("cannot void another salesperson's lead (ownership)", async () => {
    const id = await newLead(mathiew);
    await expect(leads.voidLead(kevin, id, "not mine")).rejects.toThrow();
  });

  it("voids pending payments along with the lead", async () => {
    const id = await newLead();
    await addPayment(id, AuditStatus.PENDING_AUDIT);
    await leads.voidLead(mathiew, id, "test lead");
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id }, include: { payments: true } });
    expect(e.payments.every((p) => p.voided)).toBe(true);
  });

  it("BLOCKS voiding when an APPROVED payment exists (Super Admin must reverse first)", async () => {
    const id = await newLead();
    await addPayment(id, AuditStatus.APPROVED);
    await expect(leads.voidLead(mathiew, id, "has money")).rejects.toThrow(/approved payment/i);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.voided).toBe(false); // untouched
  });
});

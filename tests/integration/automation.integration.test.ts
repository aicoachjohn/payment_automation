// @vitest-environment node
/**
 * Phase 10 — automation engine (FR-SAL-49..66, BR-07..10). Time-travel tests: rather than
 * waiting, we seed a Course Starting approval and then move the approval date and `now`.
 * Covers: not-started → no countdown ever; reminders on exactly the configured days;
 * the end-of-Day-15 IST boundary; idempotency (run twice → one notification); and
 * config-driven reminder days.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, LeadStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment } = await import("@/server/services/audit-decisions");
const automation = await import("@/server/services/automation");
const { setConfig } = await import("@/server/services/system-config");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
const TAG = "automation-it";
let n = 0;

const DETAILS = { fullName: "Auto", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };
const DAY = 86_400_000;

function receiptJpg(amount: string, txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm ${amount} ${txn}`)]);
}

/**
 * Seed a lead whose course HAS started, with an approved Course Starting Amount (payment
 * #1) whose approval date we then pin to `anchorApprovedAt`. Returns the enrollment id.
 */
async function seedStarted(anchorApprovedAt: Date, opts: { courseStarted?: boolean } = {}): Promise<{ leadId: string; enrollmentId: string; salespersonId: string }> {
  n += 1;
  const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await leads.markInterested(mathiew, id);
  await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `auto${n}@example.com`, mobile: `92${String(600000000 + n)}` });
  await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", courseStarted: opts.courseStarted ?? true, commencingDate: new Date(anchorApprovedAt.getTime() - DAY).toISOString() });
  await generateDraft(mathiew, id);

  const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44999.50", `AUTO${n}`), originalFilename: "p.jpg" });
  const cap = await capturePayment(mathiew, id, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: "44999.50", paymentDate: anchorApprovedAt.toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: `AUTO${n}`, confirmations: CONF, varianceReason: "seed", manualEntryNoOcr: false,
  });
  await approvePayment(nandhiya, cap.paymentId, { confirmations: OK, varianceReason: "ok" });
  // Pin the approval timestamp (the countdown anchor) to the controlled date.
  await prisma.payment.update({ where: { id: cap.paymentId }, data: { auditedAt: anchorApprovedAt } });
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  return { leadId: id, enrollmentId: e.id, salespersonId: mathiew.userId };
}

async function remindersFor(enrollmentId: string): Promise<number> {
  return prisma.notification.count({ where: { relatedEntityId: enrollmentId, type: "DEADLINE_REMINDER" } });
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  await prisma.jobRun.deleteMany({ where: { dedupeKey: { contains: TAG } } }).catch(() => {});
  if (eids.length) {
    await prisma.jobRun.deleteMany({ where: { OR: eids.map((id) => ({ dedupeKey: { contains: id } })) } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { relatedEntityId: { in: eids } } });
    await prisma.operationsHandover.deleteMany({ where: { enrollmentId: { in: eids } } });
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.followUpTask.deleteMany({ where: { leadId: { in: ids } } }); await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  nandhiya = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "nandhiya@proitbridge.local" } })).id, role: Role.DATA_MGMT_AUDITOR };
  superAdmin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "super.admin@proitbridge.local" } })).id, role: Role.SUPER_ADMIN };
  void superAdmin;
  await setConfig(superAdmin, "reminder_days", [3, 7, 10, 13, 14]);
  await cleanup();
});
beforeEach(async () => { await prisma.jobRun.deleteMany({ where: { dedupeKey: { contains: TAG } } }).catch(() => {}); });
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

// A stable anchor: 00:00 IST on a fixed day, so day arithmetic is unambiguous.
function anchorAt(): Date {
  return new Date(automation.istDayStartUtc(new Date("2026-05-10T06:00:00Z")).getTime() + 10 * 3_600_000); // ~10:00 IST
}

describe("Verify #1 — a NOT-started course never gets a countdown", () => {
  it("no reminders and no transfer, even far past 'Day 15'", async () => {
    const anchor = anchorAt();
    const s = await seedStarted(anchor, { courseStarted: false });
    // Even at day 20, nothing should happen for a not-started course.
    for (const day of [3, 7, 13, 16, 20]) {
      await automation.runDailyAutomation(new Date(anchor.getTime() + day * DAY));
    }
    expect(await remindersFor(s.enrollmentId)).toBe(0);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: s.leadId } });
    expect(lead.status).not.toBe(LeadStatus.OPERATIONS_HANDOVER);
  });
});

describe("Verify #2 — reminders fire on exactly the configured days", () => {
  it("fires on 3/7/10/13/14 and NOT on other days", async () => {
    const anchor = anchorAt();
    const s = await seedStarted(anchor);
    const fired: number[] = [];
    for (let day = 1; day <= 15; day++) {
      const before = await remindersFor(s.enrollmentId);
      await automation.runDailyAutomation(new Date(anchor.getTime() + day * DAY + 3_600_000));
      const after = await remindersFor(s.enrollmentId);
      if (after > before) fired.push(day);
    }
    console.log(`\n  [#2] reminders fired on days: ${fired.join(", ")}`);
    expect(fired).toEqual([3, 7, 10, 13, 14]);
  });
});

describe("Verify #3 — the end-of-Day-15 IST boundary", () => {
  it("down payment approved at 23:55 IST on Day 15 → NO transfer", async () => {
    const anchor = anchorAt();
    const a = await seedStarted(anchor);
    const deadline = automation.downPaymentDeadline(anchor, 15);

    // Record + approve a Down Payment, pinning its approval to 23:55 IST on Day 15.
    const proof = await uploadProof(mathiew, a.leadId, { bytes: receiptJpg("10000", `DP${a.enrollmentId.slice(-6)}`), originalFilename: "dp.jpg" });
    const cap = await capturePayment(mathiew, a.leadId, {
      proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
      receivedAmount: "10000", paymentDate: new Date(deadline.getTime() - 5 * 60_000).toISOString(), paymentMethod: PaymentMethod.UPI,
      transactionId: `DP${a.enrollmentId.slice(-6)}`, confirmations: CONF, varianceReason: "partial", manualEntryNoOcr: false,
    });
    await approvePayment(nandhiya, cap.paymentId, { confirmations: OK, varianceReason: "ok" });
    await prisma.payment.update({ where: { id: cap.paymentId }, data: { auditedAt: new Date(deadline.getTime() - 5 * 60_000) } });

    // Now the tick runs on Day 16 (after the deadline) — but the down payment is in.
    const statusBefore = (await prisma.lead.findUniqueOrThrow({ where: { id: a.leadId } })).status;
    await automation.runDailyAutomation(new Date(deadline.getTime() + DAY));
    const leadA = await prisma.lead.findUniqueOrThrow({ where: { id: a.leadId } });
    console.log(`\n  [#3a] down payment approved 23:55 Day15 → lead status=${leadA.status} (was ${statusBefore}); no transfer=${leadA.status !== LeadStatus.OPERATIONS_HANDOVER}`);
    expect(leadA.status).not.toBe(LeadStatus.OPERATIONS_HANDOVER);
    expect(await prisma.operationsHandover.count({ where: { enrollmentId: a.enrollmentId } })).toBe(0);
  });

  it("down payment still unpaid past end of Day 15 → transfer DID happen at end of Day 15", async () => {
    const anchor = anchorAt();
    const b = await seedStarted(anchor);
    const deadline = automation.downPaymentDeadline(anchor, 15);
    await automation.runDailyAutomation(new Date(deadline.getTime() + 5 * 60_000)); // 00:05 Day 16
    const leadB = await prisma.lead.findUniqueOrThrow({ where: { id: b.leadId } });
    const handoverB = await prisma.operationsHandover.findFirst({ where: { enrollmentId: b.enrollmentId } });
    console.log(`\n  [#3b] unpaid → lead status=${leadB.status}, handover=${handoverB?.handoverType}`);
    expect(leadB.status).toBe(LeadStatus.OPERATIONS_HANDOVER);
    expect(handoverB?.handoverType).toBe("AUTO_DAY15");
  });
});

describe("Verify #4 — running the daily job twice sends exactly one of each", () => {
  it("a second run on the same day adds no reminders", async () => {
    const anchor = anchorAt();
    const s = await seedStarted(anchor);
    const day3 = new Date(anchor.getTime() + 3 * DAY + 3_600_000);
    await automation.runDailyAutomation(day3);
    const afterFirst = await remindersFor(s.enrollmentId);
    await automation.runDailyAutomation(day3); // same IST day, second run
    const afterSecond = await remindersFor(s.enrollmentId);
    console.log(`\n  [#4] reminders after 1st run=${afterFirst}, after 2nd run=${afterSecond}`);
    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(1);
  });
});

describe("Verify #5 — reminder days are configuration, not code", () => {
  it("changing reminder_days to [5,10] changes the schedule with no code change", async () => {
    await setConfig(superAdmin, "reminder_days", [5, 10]);
    try {
      const anchor = anchorAt();
      const s = await seedStarted(anchor);
      const fired: number[] = [];
      for (let day = 1; day <= 14; day++) {
        const before = await remindersFor(s.enrollmentId);
        await automation.runDailyAutomation(new Date(anchor.getTime() + day * DAY + 3_600_000));
        if ((await remindersFor(s.enrollmentId)) > before) fired.push(day);
      }
      console.log(`\n  [#5] with reminder_days=[5,10], fired on: ${fired.join(", ")}`);
      expect(fired).toEqual([5, 10]);
    } finally {
      await setConfig(superAdmin, "reminder_days", [3, 7, 10, 13, 14]); // restore
    }
  });
});

// @vitest-environment node
/**
 * The handover chain: Sales → Data Management → Finance.
 *
 * The rule that matters most here is that each stage is gated only by what THAT role owns.
 * Sales were previously blocked by "no approved payment" and "an outstanding balance
 * remains" — neither of which they can fix — so the button could never succeed for them.
 * Nandhiya's gate is her own desk: every payment audited.
 *
 * Also covers the removal of the Day-15 auto-transfer: an overdue down payment now alerts
 * everyone but must NOT move the record on its own.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment } = await import("@/server/services/audit-decisions");
const { submitToDataMgmt, submitToFinance, financeApproveHandover, financeRejectHandover, buildHandoverSnapshot, HandoverError } = await import("@/server/services/handover");
const automation = await import("@/server/services/automation");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
const TAG = "handover-it";
let n = 0;
const DAY = 86_400_000;

const DETAILS = { fullName: "Handover", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };

function receiptJpg(txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm ${txn}`)]);
}

async function capture(leadId: string, amount: string, txn: string, date: string): Promise<string> {
  const proof = await uploadProof(mathiew, leadId, { bytes: receiptJpg(txn), originalFilename: "p.jpg" });
  const cap = await capturePayment(mathiew, leadId, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: amount, paymentDate: new Date(date).toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations: CONF, varianceReason: "seed", manualEntryNoOcr: false,
  });
  return cap.paymentId;
}

/** Sales have done their part: complete record, one payment captured, NOT yet audited. */
async function seedUnapproved(): Promise<{ leadId: string; enrollmentId: string }> {
  n += 1;
  const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} U${n}`, leadSource: TAG });
  await leads.markInterested(mathiew, id);
  await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} U${n}`, email: `hou${n}@example.com`, mobile: `92${String(600000000 + n)}` });
  await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", commencingDate: new Date("2026-05-01").toISOString() });
  await generateDraft(mathiew, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  // A part payment, so a balance deliberately remains.
  await capture(id, "5000.00", `HOU${n}`, "2026-05-02");
  return { leadId: id, enrollmentId: e.id };
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    await prisma.notification.deleteMany({ where: { relatedEntityId: { in: eids } } });
    await prisma.operationsHandover.deleteMany({ where: { enrollmentId: { in: eids } } });
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
  await prisma.jobRun.deleteMany({ where: { dedupeKey: { contains: TAG } } }).catch(() => {});
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  nandhiya = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "nandhiya@proitbridge.local" } })).id, role: Role.DATA_MGMT_AUDITOR };
  rajesh = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "rajesh@proitbridge.local" } })).id, role: Role.FINANCE_REVIEWER };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("stage 1 — Sales submit to Data Management", () => {
  it("goes through with payments still PENDING and a balance outstanding", async () => {
    // The bug this pins: Sales were blocked by "at least one approved payment" and "an
    // outstanding balance remains", which are Nandhiya's job, so they could never submit.
    const s = await seedUnapproved();
    const snap = await buildHandoverSnapshot(s.enrollmentId);
    expect(snap.readyForDataMgmt, "Sales' own record is complete").toBe(true);
    expect(snap.dataMgmtMissing.length, "but Nandhiya still has work").toBeGreaterThan(0);

    const res = await submitToDataMgmt(mathiew, s.enrollmentId);
    expect(res.message).toMatch(/Nandhiya/i);

    const h = await prisma.operationsHandover.findFirstOrThrow({ where: { enrollmentId: s.enrollmentId } });
    expect(h.stage).toBe("WITH_DATA_MGMT");
  });

  it("still blocks on what Sales DO own, naming the exact field", async () => {
    const s = await seedUnapproved();
    await prisma.enrollment.update({ where: { id: s.enrollmentId }, data: { commencingDate: null } });
    let msg = "";
    try { await submitToDataMgmt(mathiew, s.enrollmentId); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/Commencing date/i);
    expect(() => { throw new HandoverError("x"); }).toThrow();
  });

  it("refuses a second submission of the same learner", async () => {
    const s = await seedUnapproved();
    await submitToDataMgmt(mathiew, s.enrollmentId);
    await expect(submitToDataMgmt(mathiew, s.enrollmentId)).rejects.toThrow(/already with Data Management/i);
  });
});

describe("stage 2 — Data Management pass it to Finance", () => {
  it("is refused while any payment is still awaiting audit", async () => {
    const s = await seedUnapproved();
    const { handoverId } = await submitToDataMgmt(mathiew, s.enrollmentId);
    await expect(submitToFinance(nandhiya, handoverId)).rejects.toThrow(/Audit decision on payment/i);
  });

  it("goes through once every payment is approved — an outstanding balance is fine", async () => {
    const s = await seedUnapproved();
    const { handoverId } = await submitToDataMgmt(mathiew, s.enrollmentId);

    // Approve the one payment. It is a part payment, so a balance REMAINS — that must not
    // stop the record reaching Finance; Rajesh sees the balance and chases it.
    const pending = await prisma.payment.findFirstOrThrow({ where: { enrollmentId: s.enrollmentId } });
    await approvePayment(nandhiya, pending.id, { confirmations: OK, varianceReason: "accepted" });

    const snap = await buildHandoverSnapshot(s.enrollmentId);
    expect(snap.readyForFinance).toBe(true);

    const res = await submitToFinance(nandhiya, handoverId);
    expect(res.message).toMatch(/Rajesh|Finance/i);

    const h = await prisma.operationsHandover.findUniqueOrThrow({ where: { id: handoverId } });
    expect(h.stage).toBe("WITH_FINANCE");
    expect(h.passedToFinanceBy).toBe(nandhiya.userId);

    // And there is still money owed — proving the gate really is "audited", not "fully paid".
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId } });
    expect(Number(e.finalApprovedFee)).toBeGreaterThan(Number(pending.receivedAmount));
  });

  it("only Data Management may pass it on", async () => {
    const s = await seedUnapproved();
    const { handoverId } = await submitToDataMgmt(mathiew, s.enrollmentId);
    await expect(submitToFinance(mathiew, handoverId)).rejects.toThrow();
  });
});

describe("stage 3 — Finance sign it off, or send it back", () => {
  /** Get a record all the way to Finance's desk. */
  async function withFinance() {
    const s = await seedUnapproved();
    const { handoverId } = await submitToDataMgmt(mathiew, s.enrollmentId);
    const p = await prisma.payment.findFirstOrThrow({ where: { enrollmentId: s.enrollmentId } });
    await approvePayment(nandhiya, p.id, { confirmations: OK, varianceReason: "accepted" });
    await submitToFinance(nandhiya, handoverId);
    return { ...s, handoverId };
  }

  it("Rajesh approves → the record is signed off", async () => {
    const { handoverId } = await withFinance();
    const res = await financeApproveHandover(rajesh, handoverId);
    expect(res.message).toMatch(/signed off/i);
    const h = await prisma.operationsHandover.findUniqueOrThrow({ where: { id: handoverId } });
    expect(h.stage).toBe("FINANCE_APPROVED");
    expect(h.financeDecisionBy).toBe(rajesh.userId);
  });

  it("Rajesh rejects → it goes BACK to Data Management carrying his reason", async () => {
    const { handoverId } = await withFinance();
    await financeRejectHandover(rajesh, handoverId, "Bank reference does not match the statement");

    const h = await prisma.operationsHandover.findUniqueOrThrow({ where: { id: handoverId } });
    expect(h.stage, "back on Nandhiya's desk").toBe("WITH_DATA_MGMT");
    expect(h.financeRejectionReason).toMatch(/Bank reference/i);

    // And Nandhiya can send it straight back once she has dealt with it.
    const again = await submitToFinance(nandhiya, handoverId);
    expect(again.message).toMatch(/Rajesh|Finance/i);
    expect((await prisma.operationsHandover.findUniqueOrThrow({ where: { id: handoverId } })).stage).toBe("WITH_FINANCE");
  });

  it("a rejection without a reason is refused (BR-16)", async () => {
    const { handoverId } = await withFinance();
    await expect(financeRejectHandover(rajesh, handoverId, "   ")).rejects.toThrow(/what is wrong/i);
  });

  it("only Finance may sign off — and never twice", async () => {
    const { handoverId } = await withFinance();
    await expect(financeApproveHandover(nandhiya, handoverId)).rejects.toThrow();
    await financeApproveHandover(rajesh, handoverId);
    await expect(financeApproveHandover(rajesh, handoverId)).rejects.toThrow(/already signed/i);
  });

  it("cannot sign off a record still sitting with Data Management", async () => {
    const s = await seedUnapproved();
    const { handoverId } = await submitToDataMgmt(mathiew, s.enrollmentId);
    await expect(financeApproveHandover(rajesh, handoverId)).rejects.toThrow(/still with Data Management/i);
  });

  it("Finance's decision never touches the payment record itself (BR-18 where it counts)", async () => {
    const { enrollmentId, handoverId } = await withFinance();
    const before = await prisma.payment.findFirstOrThrow({ where: { enrollmentId } });
    await financeRejectHandover(rajesh, handoverId, "Please re-check the proof");
    const after = await prisma.payment.findFirstOrThrow({ where: { id: before.id } });

    // The money and the audit decision are exactly as Nandhiya left them.
    expect(after.receivedAmount.toString()).toBe(before.receivedAmount.toString());
    expect(after.auditStatus).toBe(before.auditStatus);
    expect(after.transactionId).toBe(before.transactionId);
    expect(after.auditedBy).toBe(before.auditedBy);
  });
});

describe("an overdue down payment alerts everyone but never moves the record", () => {
  it("notifies Sales, the manager, Nandhiya and Rajesh — and creates NO handover", async () => {
    // The Day-15 auto-transfer was removed: every handover is now submitted by a person.
    // The chasing still has to happen, so the alert must survive the removal.
    n += 1;
    const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} T${n}`, leadSource: TAG });
    await leads.markInterested(mathiew, id);
    await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} T${n}`, email: `hot${n}@example.com`, mobile: `90${String(600000000 + n)}` });
    const anchor = new Date(automation.istDayStartUtc(new Date("2026-06-10T06:00:00Z")).getTime() + 10 * 3_600_000);
    await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", courseStarted: true, commencingDate: new Date(anchor.getTime() - DAY).toISOString() });
    await generateDraft(mathiew, id);
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
    const half = (Number(e.finalApprovedFee) / 2).toFixed(2);
    const p1 = await capture(id, half, `HOT${n}`, anchor.toISOString());
    await approvePayment(nandhiya, p1, { confirmations: OK, varianceReason: "ok" });
    await prisma.payment.update({ where: { id: p1 }, data: { auditedAt: anchor } });

    const deadline = automation.downPaymentDeadline(anchor, 15);
    await automation.runDailyAutomation(new Date(deadline.getTime() + 5 * 60_000));

    const notified = await prisma.notification.findMany({ where: { relatedEntityId: e.id, type: "DOWN_PAYMENT_OVERDUE" }, select: { recipientId: true } });
    const recipientRoles = await prisma.user.findMany({ where: { id: { in: notified.map((x) => x.recipientId) } }, select: { role: true } });
    const roles = new Set(recipientRoles.map((r) => r.role));

    expect(roles.has(Role.SALESPERSON)).toBe(true);
    expect(roles.has(Role.SALES_MANAGER)).toBe(true);
    expect(roles.has(Role.DATA_MGMT_AUDITOR)).toBe(true);
    expect(roles.has(Role.FINANCE_REVIEWER)).toBe(true);

    const handover = await prisma.operationsHandover.findFirst({ where: { enrollmentId: e.id } });
    expect(handover, "nothing may hand itself over").toBeNull();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.status, "and the lead must not jump to OPERATIONS_HANDOVER").not.toBe("OPERATIONS_HANDOVER");
  });
});

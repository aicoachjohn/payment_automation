// @vitest-environment node
/**
 * Phase 10 — Operations handover (FR-SAL-67..71, BR-12) + the Day-15 transfer's fan-out.
 *   Verify #6: a handover on an enrollment missing a Transaction ID is blocked and names
 *   that EXACT field. Plus: a complete handover returns exactly "Handover Successfully
 *   Sent."; and the automatic Day-15 transfer notifies the salesperson, Sales Manager,
 *   Nandhiya and Rajesh and creates the consolidated Operations record.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, AuditStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment } = await import("@/server/services/audit-decisions");
const { performHandover, buildHandoverSnapshot, HandoverError } = await import("@/server/services/handover");
const automation = await import("@/server/services/automation");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
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

/** A fully-paid, complete enrollment ready for a MANUAL handover. */
async function seedFullyPaid(): Promise<{ leadId: string; enrollmentId: string; fee: number }> {
  n += 1;
  const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await leads.markInterested(mathiew, id);
  await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `ho${n}@example.com`, mobile: `91${String(600000000 + n)}` });
  await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", commencingDate: new Date("2026-05-01").toISOString() });
  await generateDraft(mathiew, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  const fee = Number(e.finalApprovedFee);
  const half = (fee / 2).toFixed(2);
  const p1 = await capture(id, half, `HO${n}A`, "2026-05-02");
  await approvePayment(nandhiya, p1, { confirmations: OK, varianceReason: "ok" });
  const p2 = await capture(id, (fee - Number(half)).toFixed(2), `HO${n}B`, "2026-05-03");
  await approvePayment(nandhiya, p2, { confirmations: OK, varianceReason: "ok" });
  return { leadId: id, enrollmentId: e.id, fee };
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
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("Verify #6 — a blocked handover names the exact missing field", () => {
  it("missing Transaction ID → error names 'Transaction ID'", async () => {
    const s = await seedFullyPaid();
    // Complete first → success with the exact confirmation string.
    const ok = await performHandover(mathiew, s.enrollmentId);
    expect(ok.message).toBe("Handover Successfully Sent.");

    // Simulate a record missing its Transaction ID. The approved-payment immutability
    // trigger (correctly) freezes the Txn ID, so we clear `locked` first — a test-only
    // manipulation to reach the state the validator must catch.
    const approved = await prisma.payment.findFirstOrThrow({ where: { enrollmentId: s.enrollmentId, auditStatus: AuditStatus.APPROVED }, orderBy: { paymentNumber: "asc" } });
    await prisma.payment.update({ where: { id: approved.id }, data: { locked: false } });
    await prisma.payment.update({ where: { id: approved.id }, data: { transactionId: "" } });
    const snap = await buildHandoverSnapshot(s.enrollmentId);

    let msg = "";
    try { await performHandover(mathiew, s.enrollmentId); } catch (e) { msg = (e as Error).message; }
    console.log(`\n  [#6] complete → "${ok.message}"; missing-txn error → "${msg}"`);
    expect(snap.complete).toBe(false);
    expect(msg).toMatch(/Transaction ID/i);
    expect(msg).toContain(`payment #${approved.paymentNumber}`);
  });

  it("missing commencing date → error names 'Commencing date'", async () => {
    const s = await seedFullyPaid();
    await prisma.enrollment.update({ where: { id: s.enrollmentId }, data: { commencingDate: null } });
    let msg = "";
    try { await performHandover(mathiew, s.enrollmentId); } catch (e) { msg = (e as Error).message; }
    console.log(`  [#6b] missing commencing date → "${msg}"`);
    expect(msg).toMatch(/Commencing date/i);
    expect(() => { throw new HandoverError("x"); }).toThrow();
  });
});

describe("Day-15 auto-transfer notifies all the parties (FR-SAL-53/62)", () => {
  it("salesperson, Sales Manager, Nandhiya and Rajesh are notified and a handover is recorded", async () => {
    // Seed a started course with only the Course Starting Amount approved (down payment pending).
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
    const handover = await prisma.operationsHandover.findFirst({ where: { enrollmentId: e.id } });

    console.log(`\n  [transfer] notified roles: ${[...roles].join(", ")} + Operations record=${handover?.handoverType}`);
    expect(roles.has(Role.SALESPERSON)).toBe(true);
    expect(roles.has(Role.SALES_MANAGER)).toBe(true);
    expect(roles.has(Role.DATA_MGMT_AUDITOR)).toBe(true);
    expect(roles.has(Role.FINANCE_REVIEWER)).toBe(true);
    expect(handover?.handoverType).toBe("AUTO_DAY15"); // the 5th party — Operations — receives the record
  });
});

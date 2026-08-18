// @vitest-environment node
/**
 * Phase 7 — L1 audit gate (FR-DM-14..23, FR-REC-02..04/09, BR-15/16/27). The core
 * control, tested hard: gated approval, correction/reject reasons, the single Finance
 * predicate, immutability (DB trigger), and payment-level auditing.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, AuditStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { createLead, markInterested, selectCourse, updateBasicDetails } = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment, requestCorrection, rejectPayment, getAuditRecord, auditTimeline } = await import("@/server/services/audit-decisions");
const { financeVisiblePaymentWhere } = await import("@/server/services/finance-visibility");
const { AuthorizationError } = await import("@/server/auth/permissions");

const prisma = new PrismaClient();
let nandhiya: { userId: string; role: Role };
let mathiew: { userId: string; role: Role };
const TAG = "phase7-it";
let n = 0;

const DETAILS = { fullName: "Audit Lead", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };

function receiptJpg(amount: string, txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm\n₹${amount}\nUPI\n11 Aug 2026\nRef No: ${txn}`)]);
}

async function readyLead(): Promise<string> {
  n += 1;
  const { id } = await createLead(mathiew, { fullName: DETAILS.fullName, leadSource: TAG });
  await markInterested(mathiew, id);
  await updateBasicDetails(mathiew, id, { ...DETAILS, email: `audit${n}@example.com`, mobile: `98${String(500000000 + n)}` });
  await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  await generateDraft(mathiew, id);
  return id;
}

async function capture(leadId: string, amount: string, txn: string, varianceReason?: string) {
  const proof = await uploadProof(mathiew, leadId, { bytes: receiptJpg(amount, txn), originalFilename: "p.jpg" });
  const res = await capturePayment(mathiew, leadId, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: amount.replace(/,/g, ""), paymentDate: new Date("2026-08-11").toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations: { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true },
    varianceReason, manualEntryNoOcr: false,
  });
  return res.paymentId;
}

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = leads.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = leads.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

beforeAll(async () => {
  nandhiya = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "nandhiya@proitbridge.local" } })).id, role: Role.DATA_MGMT_AUDITOR };
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("approval is gated (FR-REC-02, BR-27, FR-DM-22)", () => {
  it("blocked without all three match confirmations", async () => {
    const id = await capture(await readyLead(), "44999.50", "V7CONF001");
    await expect(approvePayment(nandhiya, id, { confirmations: { amountMatches: true, dateMatches: false, transactionIdMatches: true } })).rejects.toThrow(/confirm.*amount.*date.*transaction id/i);
  });
  it("blocked when the proof is missing", async () => {
    const id = await capture(await readyLead(), "44999.50", "V7PROOF01");
    await prisma.paymentProof.deleteMany({ where: { paymentId: id } });
    await expect(approvePayment(nandhiya, id, { confirmations: OK })).rejects.toThrow(/proof is missing/i);
  });
  it("blocked when the Transaction ID is blank", async () => {
    const id = await capture(await readyLead(), "44999.50", "V7TXN0001");
    await prisma.payment.update({ where: { id }, data: { transactionId: "" } });
    await expect(approvePayment(nandhiya, id, { confirmations: OK })).rejects.toThrow(/Transaction ID is blank/i);
  });
  it("only DATA_MGMT_AUDITOR may audit (a salesperson is refused)", async () => {
    const id = await capture(await readyLead(), "44999.50", "V7ROLE001");
    await expect(approvePayment(mathiew, id, { confirmations: OK })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("correction & rejection require a reason (FR-DM-16, BR-16)", () => {
  it("correction with an empty reason is refused; with a reason it routes back", async () => {
    const id = await capture(await readyLead(), "44999.50", "V7CORR001");
    await expect(requestCorrection(nandhiya, id, { comment: "" })).rejects.toThrow(/reason is required/i);
    await requestCorrection(nandhiya, id, { reasonCode: "Proof unreadable", comment: "Please re-upload a clearer screenshot" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).auditStatus).toBe(AuditStatus.CORRECTION_REQUIRED);
  });
  it("rejection with an empty reason is refused", async () => {
    const id = await capture(await readyLead(), "44999.50", "V7REJ0001");
    await expect(rejectPayment(nandhiya, id, { comment: "" })).rejects.toThrow(/reason is required/i);
  });
});

describe("variance & over-collection (FR-REC-03/04)", () => {
  it("variance blocks approval until accepted with a reason", async () => {
    const id = await capture(await readyLead(), "30000", "V7VAR0001", "Partial holding");
    await expect(approvePayment(nandhiya, id, { confirmations: OK })).rejects.toThrow(/differs from the expected/i);
    await approvePayment(nandhiya, id, { confirmations: OK, varianceReason: "Accepted — agreed partial holding" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).auditStatus).toBe(AuditStatus.APPROVED);
  });
  it("over-collection is blocked, and the message names a remedy that actually exists", async () => {
    const leadId = await readyLead();
    const p1 = await capture(leadId, "44999.50", "V7OVER001");
    await approvePayment(nandhiya, p1, { confirmations: OK });
    const p2 = await capture(leadId, "50000", "V7OVER002", "overpay");

    let msg = "";
    try {
      await approvePayment(nandhiya, p2, { confirmations: OK, varianceReason: "accepting" });
    } catch (e) { msg = (e as Error).message; }

    expect(msg).toMatch(/above the Final Approved Fee/i);
    // There is NO over-collection override — the Super Admin's delegated audit runs this
    // same guard — so the message must not send the auditor chasing one. It used to, which
    // left records stuck with no way forward.
    expect(msg, "must not promise a Super Admin override that does not exist").not.toMatch(/Super Admin override/i);
    expect(msg, "must point at unlocking the fee or sending it back").toMatch(/unlock the fee|correction/i);
  });
});

describe("Finance visibility — only APPROVED reaches Finance (FR-DM-20, BR-15)", () => {
  it("PENDING is invisible to Finance; APPROVED becomes visible; REJECTED stays excluded but in history", async () => {
    const pending = await capture(await readyLead(), "44999.50", "V7FIN0001");
    const visibleWhilePending = await prisma.payment.count({ where: financeVisiblePaymentWhere({ id: pending }) });
    expect(visibleWhilePending).toBe(0);

    await approvePayment(nandhiya, pending, { confirmations: OK });
    const visibleAfterApprove = await prisma.payment.count({ where: financeVisiblePaymentWhere({ id: pending }) });
    expect(visibleAfterApprove).toBe(1);

    const rejected = await capture(await readyLead(), "44999.50", "V7FIN0002");
    await rejectPayment(nandhiya, rejected, { comment: "Wrong lead" });
    expect(await prisma.payment.count({ where: financeVisiblePaymentWhere({ id: rejected }) })).toBe(0); // excluded from Finance
    expect((await auditTimeline(nandhiya, rejected)).some((e) => e.action === "AUDIT_REJECT")).toBe(true); // but in history
  });
});

describe("immutability once approved (FR-REC-09) + payment-level auditing", () => {
  it("an approved payment cannot have its financial fields edited (DB trigger)", async () => {
    const id = await capture(await readyLead(), "44999.50", "V7IMM0001");
    await approvePayment(nandhiya, id, { confirmations: OK });
    await expect(prisma.payment.update({ where: { id }, data: { receivedAmount: "1.00" } })).rejects.toThrow(/immutable/i);
  });
  it("payment 1 can be approved while payment 2 stays pending (FRD 3.2 rule 2)", async () => {
    const leadId = await readyLead();
    const p1 = await capture(leadId, "44999.50", "V7LVL0001");
    const p2 = await capture(leadId, "44999.50", "V7LVL0002");
    await approvePayment(nandhiya, p1, { confirmations: OK });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p1 } })).auditStatus).toBe(AuditStatus.APPROVED);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p2 } })).auditStatus).toBe(AuditStatus.PENDING_AUDIT);
    // Context surfaces total received + balance for the record under audit (FR-DM-04).
    const rec = await getAuditRecord(nandhiya, p2);
    expect(rec.totalReceivedToDate).toBe("44999.50");
    expect(rec.balance).toBe("44999.50"); // 89,999.00 − 44,999.50
  });
});

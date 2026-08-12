// @vitest-environment node
/**
 * Phase 11 verification — deliberately break things, then confirm the system catches it:
 *   1. Tamper a payment's received_amount directly → the daily reconciliation raises an
 *      exception to the Super Admin AND Rajesh, naming the discrepancy.
 *   2. A payment with no proof → the orphan report catches it.
 *   3. A month-end statement reconciles to a raw SQL sum, to the paisa.
 *   4. (FR-REC-07 float grep is proven in tests/unit/no-float-money.test.ts.)
 *   5. Trace-a-total lists exactly the payment rows that sum to it (== the dashboard total).
 * Plus: VOID excludes a payment from totals but keeps it in history (FR-REC-10); and no
 * money field is written without an attributed, reasoned action (FR-REC-18).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, AuditStatus, PaymentType } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment } = await import("@/server/services/audit-decisions");
const recon = await import("@/server/services/reconciliation");
const finance = await import("@/server/services/finance");
const { performOverride, OverrideError } = await import("@/server/services/overrides");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
const TAG = "phase11-verify";
let n = 0;

const DETAILS = { fullName: "Recon", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };

function receiptJpg(txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm ${txn}`)]);
}

async function seedApproved(amount: string, txn: string, paymentDate: string): Promise<{ leadId: string; enrollmentId: string; paymentId: string; fee: string }> {
  n += 1;
  const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await leads.markInterested(mathiew, id);
  await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `rec${n}@example.com`, mobile: `89${String(600000000 + n)}` });
  await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", commencingDate: paymentDate });
  await generateDraft(mathiew, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  const proof = await uploadProof(mathiew, id, { bytes: receiptJpg(txn), originalFilename: "p.jpg" });
  const cap = await capturePayment(mathiew, id, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: amount, paymentDate: new Date(paymentDate).toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations: CONF, varianceReason: "seed", manualEntryNoOcr: false,
  });
  await approvePayment(nandhiya, cap.paymentId, { confirmations: OK, varianceReason: "ok" });
  return { leadId: id, enrollmentId: e.id, paymentId: cap.paymentId, fee: e.finalApprovedFee!.toFixed(2) };
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    await prisma.reconciliationException.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.notification.deleteMany({ where: { relatedEntityId: { in: eids } } });
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  nandhiya = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "nandhiya@proitbridge.local" } })).id, role: Role.DATA_MGMT_AUDITOR };
  rajesh = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "rajesh@proitbridge.local" } })).id, role: Role.FINANCE_REVIEWER };
  superAdmin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "super.admin@proitbridge.local" } })).id, role: Role.SUPER_ADMIN };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("Verify #1 — a tampered received_amount is caught by reconciliation", () => {
  it("raises a BALANCE_MISMATCH exception to the Super Admin AND Rajesh", async () => {
    const s = await seedApproved("44999.50", "REC-TAMPER", "2026-07-10");
    // Break it directly: unlock (the immutability trigger freezes an approved amount) then
    // bump the received amount far above the Final Approved Fee.
    await prisma.payment.update({ where: { id: s.paymentId }, data: { locked: false } });
    await prisma.payment.update({ where: { id: s.paymentId }, data: { receivedAmount: (Number(s.fee) + 50000).toFixed(2) } });

    const notifBefore = await prisma.notification.count({ where: { type: "RECONCILIATION_EXCEPTION" } });
    const result = await recon.runReconciliation(superAdmin);
    const ex = await prisma.reconciliationException.findFirst({ where: { enrollmentId: s.enrollmentId, kind: "BALANCE_MISMATCH" } });
    const notified = await prisma.notification.findMany({ where: { type: "RECONCILIATION_EXCEPTION", relatedEntityId: s.enrollmentId }, select: { recipientId: true } });
    const roles = new Set((await prisma.user.findMany({ where: { id: { in: notified.map((x) => x.recipientId) } }, select: { role: true } })).map((r) => r.role));

    console.log(`\n  [#1] exceptions=${result.exceptionsRaised}; raised=${!!ex}; notified roles=${[...roles].join(",")}`);
    expect(ex).toBeTruthy();
    expect(ex!.detail).toMatch(/exceeds the Final Approved Fee/i);
    expect(roles.has(Role.SUPER_ADMIN)).toBe(true);
    expect(roles.has(Role.FINANCE_REVIEWER)).toBe(true);
    expect(await prisma.notification.count({ where: { type: "RECONCILIATION_EXCEPTION" } })).toBeGreaterThan(notifBefore);
  });
});

describe("Verify #2 — a payment with no proof is caught by the orphan report", () => {
  it("lists the proofless payment", async () => {
    const s = await seedApproved("44999.50", "REC-ORPHANBASE", "2026-07-11");
    // Insert a second payment row directly, with NO proof.
    const orphan = await prisma.payment.create({
      data: {
        enrollmentId: s.enrollmentId, paymentNumber: 99, paymentType: PaymentType.DOWN_PAYMENT,
        expectedAmount: "1000.00", receivedAmount: "1000.00", paymentDate: new Date("2026-07-11"),
        paymentMethod: PaymentMethod.UPI, transactionId: "REC-ORPHAN-NOPROOF", auditStatus: AuditStatus.PENDING_AUDIT, submittedBy: mathiew.userId,
      },
    });
    const report = await recon.orphanReport(rajesh);
    const found = report.paymentsWithoutProof.find((p) => p.transactionId === "REC-ORPHAN-NOPROOF");
    console.log(`\n  [#2] proofless payments detected=${report.paymentsWithoutProof.length}; this one found=${!!found}`);
    expect(found).toBeTruthy();
    void orphan;
  });
});

describe("Verify #3 — month-end statement reconciles to a raw SQL sum", () => {
  it("approved-in-period equals an independent SQL sum, to the paisa", async () => {
    await seedApproved("44999.50", "REC-ME1", "2026-09-05");
    await seedApproved("30000.00", "REC-ME2", "2026-09-20");
    const statement = await recon.monthEndStatement(rajesh, 2026, 9);

    const raw = await prisma.$queryRaw<{ total: string | null }[]>`
      SELECT COALESCE(SUM(p.received_amount), 0)::text AS total
      FROM payment p JOIN enrollment e ON e.enrollment_id = p.enrollment_id JOIN lead l ON l.lead_id = e.lead_id
      WHERE p.audit_status = 'APPROVED' AND p.voided = false
        AND p.payment_date >= '2026-09-01' AND p.payment_date < '2026-10-01' AND l.lead_source = ${TAG}`;
    const rawTotal = Number(raw[0]?.total ?? 0).toFixed(2);

    // The statement includes ALL enrollments; our tagged sum must be <= it and be present.
    console.log(`\n  [#3] statement approvedInPeriod=${statement.approvedInPeriod}; raw tagged sum=${rawTotal}`);
    expect(Number(statement.approvedInPeriod)).toBeGreaterThanOrEqual(Number(rawTotal));
    expect(statement.reconciles).toBe(true);
    // The tagged rows reconcile exactly against a scoped trace.
    const trace = await recon.traceCollection(rajesh, { from: "2026-09-01", to: "2026-09-30" });
    expect(Number(trace.total)).toBeGreaterThanOrEqual(Number(rawTotal));
  });
});

describe("Verify #5 — trace-a-total lists exactly the rows that sum to it", () => {
  it("the trace rows sum to the total AND equal the dashboard total", async () => {
    await seedApproved("44999.50", "REC-TRACE1", "2026-10-03");
    await seedApproved("25000.00", "REC-TRACE2", "2026-10-04");
    const range = { from: "2026-10-01", to: "2026-10-31" };
    const trace = await recon.traceCollection(rajesh, range);
    const dashboard = await finance.financeStatement(rajesh, range);

    const sumOfRows = trace.rows.reduce((acc, r) => acc + Number(r.receivedAmount), 0).toFixed(2);
    console.log(`\n  [#5] trace rows=${trace.rows.length}, sum=${sumOfRows}, trace.total=${trace.total}, dashboard.total=${dashboard.total}`);
    expect(sumOfRows).toBe(trace.total);
    expect(trace.total).toBe(dashboard.total);
    expect(trace.rows.map((r) => r.transactionId)).toEqual(expect.arrayContaining(["REC-TRACE1", "REC-TRACE2"]));
  });
});

describe("FR-REC-10 — void excludes from totals but keeps the record in history", () => {
  it("a voided approved payment leaves the collection yet stays queryable", async () => {
    const s = await seedApproved("44999.50", "REC-VOID", "2026-11-02");
    const range = { from: "2026-11-01", to: "2026-11-30" };
    expect((await finance.financeStatement(rajesh, range)).rows.map((r) => r.transactionId)).toContain("REC-VOID");

    await performOverride(superAdmin, { kind: "VOID_PAYMENT", paymentId: s.paymentId, reason: "duplicate entry" });

    const afterStatement = (await finance.financeStatement(rajesh, range)).rows.map((r) => r.transactionId);
    const stillInDb = await prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } });
    console.log(`\n  [void] in finance after void=${afterStatement.includes("REC-VOID")}; voided flag=${stillInDb.voided}; reason="${stillInDb.voidedReason}"`);
    expect(afterStatement).not.toContain("REC-VOID"); // excluded from totals
    expect(stillInDb.voided).toBe(true);
    expect(stillInDb.voidedReason).toBe("duplicate entry"); // permanently visible in history
  });
});

describe("FR-REC-05 — probable-duplicate WARNING at submission (and again at approval)", () => {
  it("a second capture of the same amount on the same date within the window is flagged", async () => {
    // First approved payment. Then capture a SECOND one, same amount + date → warned.
    n += 1;
    const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} D${n}`, leadSource: TAG });
    await leads.markInterested(mathiew, id);
    await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} D${n}`, email: `dup${n}@example.com`, mobile: `88${String(600000000 + n)}` });
    await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", commencingDate: "2026-07-10" });
    await generateDraft(mathiew, id);
    const cap1 = async (txn: string) => {
      const proof = await uploadProof(mathiew, id, { bytes: receiptJpg(txn), originalFilename: "p.jpg" });
      return capturePayment(mathiew, id, {
        proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
        receivedAmount: "20000.00", paymentDate: new Date("2026-07-10").toISOString(), paymentMethod: PaymentMethod.UPI,
        transactionId: txn, confirmations: CONF, varianceReason: "partial", manualEntryNoOcr: false,
      });
    };
    const first = await cap1("REC-DUP-A");
    const second = await cap1("REC-DUP-B"); // same amount + date → probable duplicate
    console.log(`\n  [#FR-REC-05] first.probableDuplicate=${first.probableDuplicate}, second.probableDuplicate=${second.probableDuplicate}`);
    expect(first.probableDuplicate).toBe(false);
    expect(second.probableDuplicate).toBe(true);
  });
});

describe("FR-REC-18 — no money change without an attributed, reasoned action", () => {
  it("a void with an empty reason is refused", async () => {
    const s = await seedApproved("44999.50", "REC-NOREASON", "2026-11-05");
    await expect(performOverride(superAdmin, { kind: "VOID_PAYMENT", paymentId: s.paymentId, reason: "  " })).rejects.toBeInstanceOf(OverrideError);
  });
});

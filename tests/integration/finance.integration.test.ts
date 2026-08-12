// @vitest-environment node
/**
 * Phase 8 — Finance dashboard (FR-FIN-01..26, BR-18). Proves the read side end-to-end:
 * only approved payments feed the statement/tiles/totals (the single predicate), totals
 * equal an independent sum of the underlying approved records, balances follow BR-22,
 * the customer master + history behave, GST reconciles to the paisa, and the FinanceQuery
 * thread never touches a Payment row.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, AuditStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { createLead, markInterested, selectCourse, updateBasicDetails } = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment, rejectPayment } = await import("@/server/services/audit-decisions");
const finance = await import("@/server/services/finance");
const { raiseFinanceQuery, listFinanceQueries, FinanceQueryError } = await import("@/server/services/finance-queries");
const { exportFinanceReport } = await import("@/server/services/finance-export");
const { STATEMENT_COLUMNS } = await import("@/lib/finance-columns");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevin: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
const TAG = "phase8-it";
let n = 0;

const DETAILS = { fullName: "Finance Lead", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };

function receiptJpg(amount: string, txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm\n₹${amount}\nUPI\n11 Aug 2026\nRef No: ${txn}`)]);
}

async function readyLead(actor: { userId: string; role: Role }): Promise<{ leadId: string; enrollmentId: string; fee: string }> {
  n += 1;
  const { id } = await createLead(actor, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await markInterested(actor, id);
  await updateBasicDetails(actor, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `fin${n}@example.com`, mobile: `97${String(600000000 + n)}` });
  await selectCourse(actor, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  await generateDraft(actor, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  return { leadId: id, enrollmentId: e.id, fee: e.finalApprovedFee!.toFixed(2) };
}

async function capture(actor: { userId: string; role: Role }, leadId: string, amount: string, txn: string, paymentDate: string): Promise<string> {
  const proof = await uploadProof(actor, leadId, { bytes: receiptJpg(amount, txn), originalFilename: "p.jpg" });
  const res = await capturePayment(actor, leadId, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: amount, paymentDate: new Date(paymentDate).toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations: CONF, varianceReason: "test seed", manualEntryNoOcr: false,
  });
  return res.paymentId;
}

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = leads.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    const pids = pays.map((p) => p.id);
    await prisma.financeQueryComment.deleteMany({ where: { query: { paymentId: { in: pids } } } });
    await prisma.financeQuery.deleteMany({ where: { paymentId: { in: pids } } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pids } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = leads.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

// Seeded fixture: A (approved holding), B (approved holding + pending #2), C (rejected).
let A: { leadId: string; enrollmentId: string; fee: string; approvedPaymentId: string };
let B: { leadId: string; enrollmentId: string; fee: string };
let C: { leadId: string; enrollmentId: string; rejectedPaymentId: string };

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  kevin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "kevin@proitbridge.local" } })).id, role: Role.SALESPERSON };
  nandhiya = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "nandhiya@proitbridge.local" } })).id, role: Role.DATA_MGMT_AUDITOR };
  rajesh = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "rajesh@proitbridge.local" } })).id, role: Role.FINANCE_REVIEWER };
  await cleanup();

  const a = await readyLead(mathiew);
  const aPay = await capture(mathiew, a.leadId, "44999.50", "P8AAPPROVED", "2026-08-11");
  await approvePayment(nandhiya, aPay, { confirmations: OK, varianceReason: "accepted" });
  A = { ...a, approvedPaymentId: aPay };

  const b = await readyLead(kevin);
  const bPay1 = await capture(kevin, b.leadId, "40000", "P8BAPPROVED", "2026-08-12");
  await approvePayment(nandhiya, bPay1, { confirmations: OK, varianceReason: "accepted" });
  await capture(kevin, b.leadId, "10000", "P8BPENDING", "2026-08-12"); // stays PENDING_AUDIT
  B = b;

  const c = await readyLead(mathiew);
  const cPay = await capture(mathiew, c.leadId, "44999.50", "P8CREJECTED", "2026-08-11");
  await rejectPayment(nandhiya, cPay, { reasonCode: "Proof mismatch", comment: "Rejected for test" });
  C = { ...c, rejectedPaymentId: cPay };
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

const RANGE = { from: "2026-08-01", to: "2026-08-31" };

describe("statement shows ONLY approved payments (FR-FIN-06, BR-15)", () => {
  it("includes both approved payments and excludes pending + rejected", async () => {
    const { rows } = await finance.financeStatement(rajesh, RANGE);
    const txns = rows.map((r) => r.transactionId);
    expect(txns).toContain("P8AAPPROVED");
    expect(txns).toContain("P8BAPPROVED");
    expect(txns).not.toContain("P8BPENDING");
    expect(txns).not.toContain("P8CREJECTED");
  });

  it("period total equals an independent sum over approved records", async () => {
    const { total } = await finance.financeStatement(rajesh, RANGE);
    const agg = await prisma.payment.aggregate({
      _sum: { receivedAmount: true },
      where: { auditStatus: AuditStatus.APPROVED, voided: false, paymentDate: { gte: new Date("2026-08-01"), lte: new Date("2026-08-31T23:59:59.999Z") } },
    });
    expect(total).toBe(agg._sum.receivedAmount!.toFixed(2));
  });

  it("balance = final approved fee − approved received (BR-22)", async () => {
    const { rows } = await finance.financeStatement(rajesh, RANGE);
    const rowA = rows.find((r) => r.transactionId === "P8AAPPROVED")!;
    expect(rowA.totalReceivedToDate).toBe("44999.50");
    expect(rowA.balance).toBe((Number(A.fee) - 44999.5).toFixed(2));
    // B: only the 40000 is approved; the 10000 pending must NOT reduce the balance.
    const rowB = rows.find((r) => r.transactionId === "P8BAPPROVED")!;
    expect(rowB.totalReceivedToDate).toBe("40000.00");
    expect(rowB.balance).toBe((Number(B.fee) - 40000).toFixed(2));
  });
});

describe("customer master + history (FR-FIN-11..17)", () => {
  it("lists customers with an approved payment; a rejected-only lead is absent", async () => {
    const rows = await finance.customerMaster(rajesh, {});
    const ids = rows.map((r) => r.enrollmentId);
    expect(ids).toContain(A.enrollmentId);
    expect(ids).toContain(B.enrollmentId);
    expect(ids).not.toContain(C.enrollmentId); // only a rejected payment → not a finance customer
    const rowB = rows.find((r) => r.enrollmentId === B.enrollmentId)!;
    expect(rowB.totalReceived).toBe("40000.00");
    expect(rowB.paymentStatus).toBe("PARTIAL");
  });

  it("history shows the full lifecycle but counts only approved (FR-FIN-16, verify #5)", async () => {
    const hist = await finance.customerPaymentHistory(rajesh, C.enrollmentId);
    const rejected = hist.payments.find((p) => p.transactionId === "P8CREJECTED")!;
    expect(rejected.auditStatus).toBe(AuditStatus.REJECTED);
    expect(rejected.countedInTotals).toBe(false);
    expect(hist.approvedTotal).toBe("0.00");
  });
});

describe("monthly summary + GST (FR-FIN-20/24, verify #1/#6)", () => {
  it("monthly total equals the independent approved sum, and splits reconcile", async () => {
    const s = await finance.monthlyCollectionSummary(rajesh, 2026, 8);
    const agg = await prisma.payment.aggregate({
      _sum: { receivedAmount: true },
      where: { auditStatus: AuditStatus.APPROVED, voided: false, paymentDate: { gte: new Date("2026-08-01"), lt: new Date("2026-09-01") } },
    });
    expect(s.total).toBe(agg._sum.receivedAmount!.toFixed(2));
    const typeSum = s.byType.reduce((acc, t) => acc + Number(t.value), 0).toFixed(2);
    expect(typeSum).toBe(s.total);
    const spSum = s.bySalesperson.reduce((acc, t) => acc + Number(t.value), 0).toFixed(2);
    expect(spSum).toBe(s.total);
  });

  it("GST base + GST component reconciles to total collection to the paisa", async () => {
    const g = await finance.gstSummary(rajesh, 2026, 8);
    expect((Number(g.base) + Number(g.gst)).toFixed(2)).toBe(g.total);
    expect(Number(g.total)).toBeGreaterThan(0);
  });
});

describe("outstanding + detail + overview", () => {
  it("outstanding report lists partially-paid enrollments only", async () => {
    const { rows } = await finance.outstandingReport(rajesh);
    const ids = rows.map((r) => r.enrollmentId);
    expect(ids).toContain(A.enrollmentId);
    expect(ids).toContain(B.enrollmentId);
    expect(ids).not.toContain(C.enrollmentId);
  });

  it("payment detail flags approved vs non-approved correctly", async () => {
    const approved = await finance.financePaymentDetail(rajesh, A.approvedPaymentId);
    expect(approved!.countedInTotals).toBe(true);
    expect(approved!.canRaiseQuery).toBe(true);
    const rejected = await finance.financePaymentDetail(rajesh, C.rejectedPaymentId);
    expect(rejected!.countedInTotals).toBe(false);
    expect(rejected!.canRaiseQuery).toBe(false);
  });

  it("overview: awaiting-audit is a COUNT with no value (BR-15 informational)", async () => {
    const tiles = await finance.financeOverview(rajesh);
    const awaiting = tiles.find((t) => t.key === "awaitingAudit")!;
    expect(awaiting.value).toBeNull();
    expect(awaiting.count).toBeGreaterThanOrEqual(1); // P8BPENDING is in the pipe
  });
});

describe("exports (FR-FIN-08/15) + logging (FR-AUD-05)", () => {
  it("statement CSV header row equals the on-screen column order", async () => {
    const res = await exportFinanceReport(rajesh, "statement", "csv", { statement: RANGE });
    const firstLine = (res.body as string).split("\r\n")[0];
    const expected = STATEMENT_COLUMNS.map((c) => `"${c.header}"`).join(",");
    expect(firstLine).toBe(expected);
    expect(res.recordCount).toBeGreaterThanOrEqual(2);
  });

  it("every export writes an audit-trail EXPORT entry", async () => {
    const before = await prisma.auditTrail.count({ where: { entityType: "FinanceReport", action: "EXPORT" } });
    await exportFinanceReport(rajesh, "monthly", "csv", { year: 2026, month: 8 });
    const after = await prisma.auditTrail.count({ where: { entityType: "FinanceReport", action: "EXPORT" } });
    expect(after).toBeGreaterThan(before);
  });
});

describe("FinanceQuery thread never touches a Payment (FR-FIN-10, BR-18)", () => {
  it("raises a query against an approved payment and leaves the payment untouched", async () => {
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: A.approvedPaymentId } });
    const { queryId } = await raiseFinanceQuery(rajesh, { paymentId: A.approvedPaymentId, subject: "Please confirm proof", message: "Is the reference correct?" });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: A.approvedPaymentId } });
    expect(after).toEqual(before); // byte-for-byte identical payment row
    const threads = await listFinanceQueries(rajesh);
    expect(threads.find((t) => t.id === queryId)).toBeTruthy();
  });

  it("cannot raise a query against a non-approved (invisible) payment", async () => {
    await expect(
      raiseFinanceQuery(rajesh, { paymentId: C.rejectedPaymentId, subject: "x", message: "y" }),
    ).rejects.toBeInstanceOf(FinanceQueryError);
  });
});

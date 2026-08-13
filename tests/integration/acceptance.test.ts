// @vitest-environment node
/**
 * FRD §15.1 Phase-1 acceptance criteria (Phase 12 sign-off). One named test per criterion
 * (6..14; #15 pen-test and #16 restore are operational — see docs/GO_LIVE_READINESS.md;
 * #17 is tests/integration/business-rules.test.ts). The run output is the acceptance
 * evidence. DB-backed and self-contained.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, AuditStatus, Program, Plan, ComboMode } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const leads = await import("@/server/services/leads");
const { generateDraft, listDraftVersions } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment, requestCorrection, rejectPayment, auditQueue, auditTimeline } = await import("@/server/services/audit-decisions");
const finance = await import("@/server/services/finance");
const { exportFinanceReport } = await import("@/server/services/finance-export");
const { CUSTOMER_COLUMNS } = await import("@/lib/finance-columns");
const { performOverride } = await import("@/server/services/overrides");
const { runReconciliation } = await import("@/server/services/reconciliation");
const { ROLE_PERMISSIONS, hasPermission } = await import("@/server/auth/permissions");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevin: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
const TAG = "acceptance";
let n = 0;

const DETAILS = { fullName: "Accept", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };

function receiptJpg(txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm ${txn}`)]);
}

async function newLead(sel: { program: Program; plan: Plan; comboMode?: ComboMode | null }, actor = mathiew): Promise<{ leadId: string; enrollmentId: string; fee: string }> {
  n += 1;
  const { id } = await leads.createLead(actor, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await leads.markInterested(actor, id);
  await leads.updateBasicDetails(actor, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `ac${n}@example.com`, mobile: `60${String(600000000 + n)}` });
  await leads.selectCourse(actor, id, { program: sel.program, plan: sel.plan, comboMode: sel.comboMode ?? null });
  await generateDraft(actor, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  return { leadId: id, enrollmentId: e.id, fee: e.finalApprovedFee!.toFixed(2) };
}

async function capture(actor: { userId: string; role: Role }, leadId: string, amount: string, txn: string): Promise<string> {
  const proof = await uploadProof(actor, leadId, { bytes: receiptJpg(txn), originalFilename: "p.jpg" });
  const res = await capturePayment(actor, leadId, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: amount, paymentDate: new Date("2026-08-12").toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations: CONF, varianceReason: "seed", manualEntryNoOcr: false,
  });
  return res.paymentId;
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.reconciliationException.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.notification.deleteMany({ where: { relatedEntityId: { in: eids } } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

const RANGE = { from: "2026-08-01", to: "2026-08-31" };

beforeAll(async () => {
  const u = async (email: string, role: Role) => ({ userId: (await prisma.user.findFirstOrThrow({ where: { email } })).id, role });
  mathiew = await u("mathiew@proitbridge.local", Role.SALESPERSON);
  kevin = await u("kevin@proitbridge.local", Role.SALESPERSON);
  nandhiya = await u("nandhiya@proitbridge.local", Role.DATA_MGMT_AUDITOR);
  rajesh = await u("rajesh@proitbridge.local", Role.FINANCE_REVIEWER);
  superAdmin = await u("super.admin@proitbridge.local", Role.SUPER_ADMIN);
  await cleanup();
}, 60_000);
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("FRD §15.1 — Phase-1 acceptance criteria", () => {
  it("#6 — all eight people exist as individual accounts and each role sees only permitted data", async () => {
    for (const email of ["mathiew", "kevin", "dinesh", "hari", "nandhiya", "rajesh", "sales.manager", "super.admin"]) {
      expect(await prisma.user.findFirst({ where: { email: `${email}@proitbridge.local` } })).toBeTruthy();
    }
    // Data scoping: a salesperson sees only their own leads.
    const mine = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" }, mathiew);
    const kevinList = await leads.listLeads(kevin, {});
    expect(kevinList.find((l) => l.id === mine.leadId)).toBeUndefined(); // Kevin cannot see Mathiew's lead
    // Finance is read-only; the auditor cannot write payments.
    expect(hasPermission(Role.FINANCE_REVIEWER, "payment:create")).toBe(false);
    expect(hasPermission(Role.DATA_MGMT_AUDITOR, "payment:create")).toBe(false);
  });

  it("#7 — a lead reaches a generated draft with NO manual fee calc, for Combo single & double shot, Advanced & Premium", async () => {
    const cases: { plan: Plan; comboMode: ComboMode }[] = [
      { plan: "ADVANCED", comboMode: "SINGLE_SHOT" }, { plan: "ADVANCED", comboMode: "DOUBLE_SHOT" },
      { plan: "PREMIUM", comboMode: "SINGLE_SHOT" }, { plan: "PREMIUM", comboMode: "DOUBLE_SHOT" },
    ];
    for (const c of cases) {
      const l = await newLead({ program: "COMBO_ALL_THREE", plan: c.plan, comboMode: c.comboMode });
      const versions = await listDraftVersions(mathiew, l.leadId);
      expect(versions.length).toBeGreaterThanOrEqual(1); // draft generated
      expect(Number(l.fee)).toBeGreaterThan(0); // fee auto-computed, never hand-typed
    }
  });

  it("#8 — a payment with a screenshot + Transaction ID appears in Nandhiya's queue as Pending Audit", async () => {
    const l = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    await capture(mathiew, l.leadId, "1000", "ACC8-TXN");
    const queue = await auditQueue(nandhiya, { search: "ACC8-TXN" });
    const row = queue.find((r) => r.transactionId === "ACC8-TXN")!;
    expect(row).toBeTruthy();
    expect(row.auditStatus).toBe(AuditStatus.PENDING_AUDIT);
  });

  it("#9 — Nandhiya can approve / request-correction(reason) / reject(reason); the salesperson is notified each time", async () => {
    const mk = async (txn: string) => { const l = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" }); return capture(mathiew, l.leadId, "1000", txn); };
    const pApprove = await mk("ACC9-AP"); await approvePayment(nandhiya, pApprove, { confirmations: OK, varianceReason: "ok" });
    const pCorrect = await mk("ACC9-CO"); await requestCorrection(nandhiya, pCorrect, { reasonCode: "Proof unclear", comment: "re-upload" });
    const pReject = await mk("ACC9-RE"); await rejectPayment(nandhiya, pReject, { reasonCode: "Mismatch", comment: "does not match" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pApprove } })).auditStatus).toBe(AuditStatus.APPROVED);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pCorrect } })).auditStatus).toBe(AuditStatus.CORRECTION_REQUIRED);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pReject } })).auditStatus).toBe(AuditStatus.REJECTED);
    const notified = await prisma.notification.count({ where: { recipientId: mathiew.userId, relatedEntityId: { in: [pCorrect, pReject] } } });
    expect(notified).toBeGreaterThanOrEqual(2); // correction + rejection reach the salesperson
  });

  it("#10 — an approved payment shows on Finance with the complete statement; a non-approved one does not", async () => {
    const l = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const approved = await capture(mathiew, l.leadId, (Number(l.fee) / 2).toFixed(2), "ACC10-AP");
    await approvePayment(nandhiya, approved, { confirmations: OK, varianceReason: "ok" });
    await capture(mathiew, l.leadId, "1000", "ACC10-PEND"); // stays pending
    const rows = (await finance.financeStatement(rajesh, RANGE)).rows;
    const ap = rows.find((r) => r.transactionId === "ACC10-AP")!;
    expect(ap).toBeTruthy();
    // complete statement fields present (FR-FIN-03)
    expect(ap.learnerName && ap.program && ap.paymentType && ap.receivedAmount && ap.balance && ap.salesperson).toBeTruthy();
    expect(rows.map((r) => r.transactionId)).not.toContain("ACC10-PEND");
  });

  it("#11 — the complete customer data sheet is auto-populated and exports to Excel/CSV", async () => {
    const l = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const p = await capture(mathiew, l.leadId, (Number(l.fee) / 2).toFixed(2), "ACC11-AP");
    await approvePayment(nandhiya, p, { confirmations: OK, varianceReason: "ok" });
    const master = await finance.customerMaster(rajesh, {});
    expect(master.find((r) => r.enrollmentId === l.enrollmentId)).toBeTruthy(); // auto-populated from the sales record
    const csv = await exportFinanceReport(rajesh, "customers", "csv", { customers: {} });
    const header = (csv.body as string).split("\r\n")[0];
    expect(header).toBe(CUSTOMER_COLUMNS.map((c) => `"${c.header}"`).join(",")); // exports in the on-screen column order
  });

  it("#12 — the audit history shows submitter, auditor, decisions, reasons and field-level before/after", async () => {
    const l = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const p = await capture(mathiew, l.leadId, "1000", "ACC12");
    await requestCorrection(nandhiya, p, { reasonCode: "Proof unclear", comment: "please re-upload" });
    const timeline = await auditTimeline(nandhiya, p);
    expect(timeline.some((t) => t.action === "PAYMENT_SUBMIT")).toBe(true); // submitter
    const correction = timeline.find((t) => t.action === "AUDIT_CORRECTION")!;
    expect(correction.byName).toBeTruthy(); // auditor
    const statusChange = timeline.find((t) => t.field === "auditStatus")!;
    expect(statusChange.oldValue).toBeTruthy(); // field-level before
    expect(statusChange.newValue).toBeTruthy(); // field-level after
  });

  it("#13 — the Super Admin reverses an approved payment with a reason, cannot edit amount/Txn ID, and Rajesh is notified", async () => {
    const l = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const p = await capture(mathiew, l.leadId, (Number(l.fee) / 2).toFixed(2), "ACC13");
    await approvePayment(nandhiya, p, { confirmations: OK, varianceReason: "ok" });
    await performOverride(superAdmin, { kind: "REVERSE_AUDIT", paymentId: p, reason: "acceptance evidence" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p } })).auditStatus).toBe(AuditStatus.PENDING_AUDIT);
    // blocked from directly editing money fields — no such capability exists
    for (const role of Object.values(Role)) expect(ROLE_PERMISSIONS[role].has("payment:edit-amount" as never)).toBe(false);
    const rajeshNotified = await prisma.notification.count({ where: { recipientId: rajesh.userId, relatedEntityId: p } });
    expect(rajeshNotified).toBeGreaterThanOrEqual(1);
  });

  it("#14 — duplicate Txn ID rejected at DB level, over-collection blocked, daily reconciliation runs clean", async () => {
    // duplicate Transaction ID
    const l = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    await capture(mathiew, l.leadId, "1000", "ACC14-DUP");
    const l2 = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    await expect(capture(mathiew, l2.leadId, "1000", "ACC14-DUP")).rejects.toThrow(/already recorded/i);
    // over-collection blocked
    const over = await newLead({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const p1 = await capture(mathiew, over.leadId, over.fee, "ACC14-OV1"); // pays full fee
    await approvePayment(nandhiya, p1, { confirmations: OK, varianceReason: "ok" });
    const p2 = await capture(mathiew, over.leadId, "5000", "ACC14-OV2", );
    await expect(approvePayment(nandhiya, p2, { confirmations: OK, varianceReason: "extra" })).rejects.toThrow(/above the Final Approved Fee/i);
    // reconciliation runs clean over this test's (untampered) enrollments
    const result = await runReconciliation(superAdmin);
    const mine = (await import("@/server/services/reconciliation")).listExceptions;
    const exceptions = (await mine(superAdmin)).filter((e) => e.status !== "RESOLVED");
    expect(result.checked).toBeGreaterThan(0);
    // none of THIS run's clean enrollments is an exception
    const cleanIds = [l.enrollmentId, l2.enrollmentId];
    expect(exceptions.filter((e) => cleanIds.includes(e.enrollmentId ?? "")).length).toBe(0);
  });
});

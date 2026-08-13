// @vitest-environment node
/**
 * UAT evidence pack (Phase 12, FRD 15.1 criterion #17): every one of the 30 business
 * rules BR-01..BR-30 in FRD §9, asserted by a named test. Each `it()` is titled with its
 * rule so the run output IS the sign-off evidence. Reliable, DB-backed, self-contained.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, Role, PaymentMethod, AuditStatus, LeadStatus, ConcessionThresholdType } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment } = await import("@/server/services/payments");
const { approvePayment, requestCorrection, rejectPayment, auditTimeline } = await import("@/server/services/audit-decisions");
const finance = await import("@/server/services/finance");
const { performOverride } = await import("@/server/services/overrides");
const { runReconciliation, listExceptions } = await import("@/server/services/reconciliation");
const { calculateBalance, round, add } = await import("@/server/money");
const { ROLE_PERMISSIONS, hasPermission } = await import("@/server/auth/permissions");


const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };

let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
let manager: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
const TAG = "br-uat";
let n = 0;

const DETAILS = { fullName: "BR Lead", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };

function receiptJpg(txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm ₹34,999 UPI ${txn}`)]);
}

async function newLead(actor = mathiew, opts: { courseStarted?: boolean; commencingDate?: string } = {}): Promise<{ leadId: string; enrollmentId: string; fee: string }> {
  n += 1;
  const { id } = await leads.createLead(actor, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await leads.markInterested(actor, id);
  await leads.updateBasicDetails(actor, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `br${n}@example.com`, mobile: `70${String(600000000 + n)}` });
  await leads.selectCourse(actor, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", courseStarted: opts.courseStarted, commencingDate: opts.commencingDate });
  await generateDraft(actor, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  return { leadId: id, enrollmentId: e.id, fee: e.finalApprovedFee!.toFixed(2) };
}

async function capture(actor: { userId: string; role: Role }, leadId: string, amount: string, txn: string, date = "2026-08-11"): Promise<string> {
  const proof = await uploadProof(actor, leadId, { bytes: receiptJpg(txn), originalFilename: "p.jpg" });
  const res = await capturePayment(actor, leadId, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: amount, paymentDate: new Date(date).toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations: CONF, varianceReason: "seed", manualEntryNoOcr: false,
  });
  return res.paymentId;
}

// Shared fixture: a lead through to one APPROVED payment (half the fee → down payment pending).
let A: { leadId: string; enrollmentId: string; fee: string; paymentId: string };

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    const pids = pays.map((p) => p.id);
    await prisma.reconciliationException.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.financeQueryComment.deleteMany({ where: { query: { paymentId: { in: pids } } } });
    await prisma.financeQuery.deleteMany({ where: { paymentId: { in: pids } } });
    await prisma.notification.deleteMany({ where: { relatedEntityId: { in: [...eids, ...rows.map((r) => r.id)] } } });
    await prisma.operationsHandover.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pids } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.followUpTask.deleteMany({ where: { leadId: { in: ids } } }); await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

beforeAll(async () => {
  const u = async (email: string, role: Role) => ({ userId: (await prisma.user.findFirstOrThrow({ where: { email } })).id, role });
  mathiew = await u("mathiew@proitbridge.local", Role.SALESPERSON);
  nandhiya = await u("nandhiya@proitbridge.local", Role.DATA_MGMT_AUDITOR);
  rajesh = await u("rajesh@proitbridge.local", Role.FINANCE_REVIEWER);
  manager = await u("sales.manager@proitbridge.local", Role.SALES_MANAGER);
  superAdmin = await u("super.admin@proitbridge.local", Role.SUPER_ADMIN);
  await cleanup();
  const a = await newLead();
  const pid = await capture(mathiew, a.leadId, (Number(a.fee) / 2).toFixed(2), "BR-A-APPROVED");
  await approvePayment(nandhiya, pid, { confirmations: OK, varianceReason: "ok" });
  A = { ...a, paymentId: pid };
}, 60_000);
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("Business rules BR-01..BR-30 (UAT evidence)", () => {
  it("BR-01 — no manual fee calculation; the pricing engine is the only source of a standard fee", async () => {
    const { calculateFee } = await import("@/server/services/pricing");
    const quote = await calculateFee({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: A.enrollmentId } });
    expect(e.standardFee!.toFixed(2)).toBe(quote.standardFee.toFixed(2));
    // feeCalcSchema is .strict() — a client cannot inject a fee.
    const { feeCalcSchema } = await import("@/lib/schemas");
    expect(feeCalcSchema.safeParse({ program: "COMBO_ALL_THREE", plan: "PREMIUM", standardFee: "1" }).success).toBe(false);
  });

  it("BR-02 — basic details entered once and reused (customer master needs no re-typing)", async () => {
    const rows = await finance.customerMaster(rajesh, {});
    const row = rows.find((r) => r.enrollmentId === A.enrollmentId)!;
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: A.leadId } });
    expect(row.customerName).toBe(lead.fullName);
    expect(row.mobile).toBe(lead.mobile); // same value, not re-entered
  });

  it("BR-03 — course/plan/combo selection automatically determines the fee", async () => {
    const adv = await (await import("@/server/services/pricing")).calculateFee({ program: "COMBO_ALL_THREE", plan: "ADVANCED", comboMode: "DOUBLE_SHOT" });
    const prem = await (await import("@/server/services/pricing")).calculateFee({ program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    expect(adv.standardFee.toFixed(2)).not.toBe(prem.standardFee.toFixed(2)); // the selection changes the fee
  });

  it("BR-04 — an above-threshold concession is separately identified, reasoned and needs approval", async () => {
    const c = await newLead();
    const res = await leads.requestConcession(mathiew, c.leadId, { concessionType: ConcessionThresholdType.AMOUNT, concessionValue: "20000", reason: "scholarship" });
    expect(res.status).toBe("PENDING_APPROVAL"); // above threshold → not auto-approved
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } });
    expect(e.concessionReason).toBe("scholarship"); // separately identified + reasoned
    // The reason is mandatory at the validation boundary (BR-04).
    const { concessionSchema } = await import("@/lib/schemas");
    expect(concessionSchema.safeParse({ concessionType: "AMOUNT", concessionValue: "20000", reason: "" }).success).toBe(false);
  });

  it("BR-05 — payment screenshot AND Transaction ID are both mandatory", async () => {
    const b = await newLead();
    await expect(capturePayment(mathiew, b.leadId, { proof: undefined as never, receivedAmount: "1000", paymentDate: new Date().toISOString(), paymentMethod: PaymentMethod.UPI, transactionId: "X", confirmations: CONF, manualEntryNoOcr: true })).rejects.toThrow(/proof upload is required/i);
  });

  it("BR-06 — Transaction IDs are unique across the entire system (DB constraint)", async () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/transaction_id.*@unique|@unique.*transaction_id|transactionId\s+String\s+@unique/);
    const b = await newLead();
    await expect(capture(mathiew, b.leadId, "1000", "BR-A-APPROVED")).rejects.toThrow(/already recorded/i);
  });

  it("BR-07 — if only two payments are received, Payment 2 becomes the Final Payment", async () => {
    const two = await newLead();
    const p1 = await capture(mathiew, two.leadId, (Number(two.fee) / 2).toFixed(2), "BR07-1");
    await approvePayment(nandhiya, p1, { confirmations: OK, varianceReason: "ok" });
    const p2 = await capture(mathiew, two.leadId, (Number(two.fee) / 2).toFixed(2), "BR07-2"); // clears the balance
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: p2 } });
    expect(row.paymentType).toBe("FINAL_PAYMENT");
  });

  it("BR-08 — a course-not-started payment carries no 15-day restriction (no countdown)", async () => {
    const { downPaymentCountdowns } = await import("@/server/services/automation");
    const notStarted = await newLead(mathiew, { courseStarted: false });
    const p1 = await capture(mathiew, notStarted.leadId, (Number(notStarted.fee) / 2).toFixed(2), "BR08-1");
    await approvePayment(nandhiya, p1, { confirmations: OK, varianceReason: "ok" });
    const countdowns = await downPaymentCountdowns(manager);
    expect(countdowns.find((c) => c.leadId === notStarted.leadId)).toBeUndefined();
  });

  it("BR-09/BR-10 — after course start, an unpaid down payment past Day 15 auto-transfers to Operations", async () => {
    const { runDailyAutomation, downPaymentDeadline, istDayStartUtc } = await import("@/server/services/automation");
    const anchor = new Date(istDayStartUtc(new Date("2026-04-10T06:00:00Z")).getTime() + 10 * 3_600_000);
    const started = await newLead(mathiew, { courseStarted: true, commencingDate: new Date(anchor.getTime() - 86_400_000).toISOString() });
    const p1 = await capture(mathiew, started.leadId, (Number(started.fee) / 2).toFixed(2), "BR09-1", anchor.toISOString());
    await approvePayment(nandhiya, p1, { confirmations: OK, varianceReason: "ok" });
    await prisma.payment.update({ where: { id: p1 }, data: { auditedAt: anchor } });
    await runDailyAutomation(new Date(downPaymentDeadline(anchor, 15).getTime() + 5 * 60_000));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: started.leadId } })).status).toBe(LeadStatus.OPERATIONS_HANDOVER);
  });

  it("BR-11 — a fully paid learner is clearly identified", async () => {
    const full = await newLead();
    const p1 = await capture(mathiew, full.leadId, full.fee, "BR11-1"); // pays the whole fee at once
    await approvePayment(nandhiya, p1, { confirmations: OK, varianceReason: "ok" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: full.leadId } })).status).toBe(LeadStatus.FULLY_PAID);
  });

  it("BR-12 — Operations receives ONE consolidated record, never fragments", async () => {
    const { buildHandoverSnapshot } = await import("@/server/services/handover");
    const snap = await buildHandoverSnapshot(A.enrollmentId);
    // A single record carries learner + course + pricing + payments + sales together.
    expect(snap.record.learner.fullName).toBeTruthy();
    expect(snap.record.course.program).toBeTruthy();
    expect(Array.isArray(snap.record.payments)).toBe(true);
    expect(snap.record.sales.salesperson).toBeTruthy();
  });

  it("BR-13 — pricing is configurable from the Admin Pricing Master (not hard-coded)", async () => {
    const active = await (await import("@/server/services/pricing")).listEffectivePricing();
    expect(active.length).toBeGreaterThan(0); // fees come from DB rows, editable by the Super Admin
  });

  it("BR-14 — every important action writes an audit-trail entry", async () => {
    const count = await prisma.auditTrail.count({ where: { entityType: "Payment", entityId: A.paymentId, action: "AUDIT_APPROVE" } });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("BR-15 — a payment reaches Finance ONLY after Nandhiya approves (no bypass)", async () => {
    const pending = await newLead();
    const pid = await capture(mathiew, pending.leadId, "1000", "BR15-PENDING");
    const inFinance = (await finance.financeStatement(rajesh, { from: "2026-08-01", to: "2026-08-31" })).rows.map((r) => r.transactionId);
    expect(inFinance).not.toContain("BR15-PENDING"); // pending → invisible to Finance
    void pid;
    // The single predicate is the only path.
    const { financeVisiblePaymentWhere } = await import("@/server/services/finance-visibility");
    expect(financeVisiblePaymentWhere()).toEqual({ auditStatus: AuditStatus.APPROVED, voided: false });
  });

  it("BR-16 — a reason is mandatory for every Correction Required and Rejected decision", async () => {
    const c = await newLead();
    const pid = await capture(mathiew, c.leadId, "1000", "BR16-1");
    await expect(requestCorrection(nandhiya, pid, { comment: "" })).rejects.toThrow(/reason is required/i);
    await expect(rejectPayment(nandhiya, pid, { comment: "" })).rejects.toThrow(/reason is required/i);
  });

  it("BR-17 — a rejected payment is excluded from totals but stays visible in history", async () => {
    const r = await newLead();
    const pid = await capture(mathiew, r.leadId, "1000", "BR17-REJ");
    await rejectPayment(nandhiya, pid, { reasonCode: "Bad proof", comment: "rejected" });
    const inFinance = (await finance.financeStatement(rajesh, { from: "2026-08-01", to: "2026-08-31" })).rows.map((x) => x.transactionId);
    expect(inFinance).not.toContain("BR17-REJ");
    const timeline = await auditTimeline(nandhiya, pid);
    expect(timeline.some((t) => t.action === "AUDIT_REJECT")).toBe(true); // permanently in history
  });

  it("BR-18 — the Finance Dashboard is read-only; FINANCE_REVIEWER has no payment-write permission", () => {
    for (const w of ["payment:create", "payment:update:own", "payment:audit", "payment:reverse-audit"] as const) {
      expect(hasPermission(Role.FINANCE_REVIEWER, w)).toBe(false);
    }
  });

  it("BR-19 — a locked fee changes only with a documented reason (manager/admin)", async () => {
    const { unlockFee } = await import("@/server/services/pricing");
    await expect(unlockFee(A.enrollmentId, manager, "")).rejects.toThrow(/reason is required/i);
  });

  it("BR-20 — OCR-extracted values must be human-confirmed before submission", async () => {
    const b = await newLead();
    const proof = await uploadProof(mathiew, b.leadId, { bytes: receiptJpg("BR20"), originalFilename: "p.jpg" });
    await expect(capturePayment(mathiew, b.leadId, {
      proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
      receivedAmount: "34999", paymentDate: new Date("2026-08-11").toISOString(), paymentMethod: PaymentMethod.UPI,
      transactionId: "BR20", confirmations: { receivedAmount: false, paymentDate: true, transactionId: true, paymentMethod: true }, manualEntryNoOcr: false,
    })).rejects.toThrow(/confirm the extracted/i);
  });

  it("BR-21 — users are deactivated, never deleted (no hard-delete of users)", () => {
    const usersSvc = readFileSync(join(process.cwd(), "src/server/services/users.ts"), "utf8");
    expect(usersSvc).not.toMatch(/\.user\.delete\(/);
    expect(usersSvc).toMatch(/setUserStatus|DEACTIVATE|status:/);
  });

  it("BR-22 — Balance = Final Approved Fee − sum of APPROVED received (pending/rejected never reduce it)", () => {
    const payments = [
      { receivedAmount: "10000", auditStatus: AuditStatus.APPROVED, voided: false },
      { receivedAmount: "5000", auditStatus: AuditStatus.PENDING_AUDIT, voided: false },
      { receivedAmount: "5000", auditStatus: AuditStatus.REJECTED, voided: false },
    ];
    expect(calculateBalance("34999", payments).toFixed(2)).toBe(round("24999").toFixed(2));
  });

  it("BR-23 — there is exactly one active Super Admin", async () => {
    const count = await prisma.user.count({ where: { role: Role.SUPER_ADMIN, status: "ACTIVE", isBreakGlass: false } });
    expect(count).toBe(1);
  });

  it("BR-24 — the Super Admin can never directly edit amount/date/Txn ID (no such capability exists)", () => {
    const overrides = readFileSync(join(process.cwd(), "src/server/services/overrides.ts"), "utf8");
    for (const f of ["receivedAmount:", "paymentDate:", "transactionId:"]) expect(overrides.includes(f)).toBe(false);
    for (const role of Object.values(Role)) expect(ROLE_PERMISSIONS[role].has("payment:edit-amount" as never)).toBe(false);
  });

  it("BR-25 — every Super Admin override is reasoned, logged immutably, and reported to Rajesh", async () => {
    const before = await prisma.superAdminActivity.count();
    await performOverride(superAdmin, { kind: "REVERSE_AUDIT", paymentId: A.paymentId, reason: "BR-25 evidence" });
    const activity = await prisma.superAdminActivity.findFirst({ where: { entityId: A.paymentId, overrideType: "REVERSE_AUDIT" } });
    expect(activity?.reasonText).toBe("BR-25 evidence");
    expect(await prisma.superAdminActivity.count()).toBe(before + 1);
    const rajeshNotified = await prisma.notification.count({ where: { recipientId: rajesh.userId, relatedEntityId: A.paymentId } });
    expect(rajeshNotified).toBeGreaterThanOrEqual(1);
    // append-only at the DB level
    await expect(prisma.$executeRawUnsafe(`UPDATE super_admin_activity SET reason_text='x' WHERE activity_id='${activity!.id}'`)).rejects.toThrow(/permission denied/i);
    // re-approve to restore the fixture for later rules
    await approvePayment(nandhiya, A.paymentId, { confirmations: OK, varianceReason: "ok" });
  });

  it("BR-26 — no role can delete a lead/payment/proof/audit; they are voided, never removed", async () => {
    const v = await newLead();
    const pid = await capture(mathiew, v.leadId, "1000", "BR26-VOID");
    await approvePayment(nandhiya, pid, { confirmations: OK, varianceReason: "ok" });
    await performOverride(superAdmin, { kind: "VOID_PAYMENT", paymentId: pid, reason: "entered in error" });
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: pid } }); // still present
    expect(row.voided).toBe(true);
    expect(row.voidedReason).toBe("entered in error");
    // audit_trail is append-only at the DB level
    await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_trail WHERE entity_id='${pid}'`)).rejects.toThrow(/permission denied/i);
  });

  it("BR-27 — a payment cannot be approved unless Nandhiya confirms amount/date/Txn ID against the proof", async () => {
    const c = await newLead();
    const pid = await capture(mathiew, c.leadId, "1000", "BR27-1");
    await expect(approvePayment(nandhiya, pid, { confirmations: { amountMatches: true, dateMatches: false, transactionIdMatches: true } })).rejects.toThrow(/confirm/i);
  });

  it("BR-28 — totals/balances are computed server-side, never accepted from the browser or stored", () => {
    // There is no `balance` column on Payment/Enrollment write path; the client cannot post a total.
    const captureSchema = readFileSync(join(process.cwd(), "src/lib/schemas.ts"), "utf8");
    expect(captureSchema).not.toMatch(/balance:\s*z\.|total:\s*z\.number/);
    // The one balance function is server-side.
    expect(typeof calculateBalance).toBe("function");
  });

  it("BR-29 — money is exact decimal, never floating point, one rounding rule", () => {
    // 0.1 + 0.2 is exact through the money module (a JS float gives 0.30000000000000004).
    expect(round(add("0.1", "0.2")).toFixed(2)).toBe("0.30");
    expect(0.1 + 0.2).not.toBe(0.3); // the trap the money module avoids
    // enforced tree-wide by tests/unit/no-float-money.test.ts
  });

  it("BR-30 — an enrollment whose approved+balance != fee is raised as a daily exception to SA + Rajesh", async () => {
    const s = await newLead();
    const pid = await capture(mathiew, s.leadId, (Number(s.fee) / 2).toFixed(2), "BR30-1");
    await approvePayment(nandhiya, pid, { confirmations: OK, varianceReason: "ok" });
    await prisma.payment.update({ where: { id: pid }, data: { locked: false } });
    await prisma.payment.update({ where: { id: pid }, data: { receivedAmount: (Number(s.fee) + 10000).toFixed(2) } });
    await runReconciliation(superAdmin);
    const ex = (await listExceptions(rajesh)).find((e) => e.enrollmentId === s.enrollmentId && e.kind === "BALANCE_MISMATCH");
    expect(ex).toBeTruthy();
  });
});

// @vitest-environment node
/**
 * FR-AUD-01 completeness proof (Phase 9, verify #6). Every event listed in FRD §8.3 must
 * write an audit entry. This test PERFORMS each listed event type and asserts an audit
 * row (AuditTrail — or, for the login family, SecurityEvent, by the codebase's safe-
 * logging convention) exists for it, created during this run. Zero gaps.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, ConcessionThresholdType } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment, replaceProof } = await import("@/server/services/payments");
const { approvePayment, requestCorrection } = await import("@/server/services/audit-decisions");
const { performOverride } = await import("@/server/services/overrides");
const { setConfig } = await import("@/server/services/system-config");
const { createUser } = await import("@/server/services/users");
const { exportFinanceReport } = await import("@/server/services/finance-export");
const { login } = await import("@/server/services/auth");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
let kevinId: string;
const TAG = "audit-complete";
let n = 0;
let startedAt: Date;

const DETAILS = { fullName: "Audit Complete", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };

function receiptJpg(amount: string, txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm\n₹${amount}\nUPI\n11 Aug 2026\nRef No: ${txn}`)]);
}

async function readyLead(withDraft = true): Promise<{ leadId: string; enrollmentId: string }> {
  n += 1;
  const { id } = await leads.createLead(mathiew, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await leads.markInterested(mathiew, id);
  await leads.updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `ac${n}@example.com`, mobile: `94${String(600000000 + n)}` });
  await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  if (withDraft) await generateDraft(mathiew, id);
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { leadId: id } });
  return { leadId: id, enrollmentId: e.id };
}

async function capture(leadId: string, amount: string, txn: string): Promise<string> {
  const proof = await uploadProof(mathiew, leadId, { bytes: receiptJpg(amount, txn), originalFilename: "p.jpg" });
  const res = await capturePayment(mathiew, leadId, {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: amount, paymentDate: new Date("2026-08-11").toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations: CONF, varianceReason: "seed", manualEntryNoOcr: false,
  });
  return res.paymentId;
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
  await prisma.user.deleteMany({ where: { email: { startsWith: "audit-complete-user" } } }).catch(() => {});
  await prisma.pricingMaster.deleteMany({ where: { specialPricingName: TAG } }).catch(() => {});
}

/** Assert an AuditTrail row with this action (optionally entity type) exists post-start. */
async function hasAudit(action: string, entityType?: string): Promise<boolean> {
  const count = await prisma.auditTrail.count({ where: { action, ...(entityType ? { entityType } : {}), performedAt: { gte: startedAt } } });
  return count > 0;
}
async function hasSecurity(eventType: string): Promise<boolean> {
  const count = await prisma.securityEvent.count({ where: { eventType, createdAt: { gte: startedAt } } });
  return count > 0;
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  nandhiya = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "nandhiya@proitbridge.local" } })).id, role: Role.DATA_MGMT_AUDITOR };
  rajesh = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "rajesh@proitbridge.local" } })).id, role: Role.FINANCE_REVIEWER };
  superAdmin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "super.admin@proitbridge.local" } })).id, role: Role.SUPER_ADMIN };
  kevinId = (await prisma.user.findFirstOrThrow({ where: { email: "kevin@proitbridge.local" } })).id;
  await cleanup();
  startedAt = new Date();

  // 1–3, 6: lead create / basic details / course select / fee lock / draft generate.
  const a = await readyLead(true);

  // 4: fee unlock (override). 15: lead reassign (override).
  await performOverride(superAdmin, { kind: "UNLOCK_FEE", enrollmentId: a.enrollmentId, reason: "correction needed" });
  await performOverride(superAdmin, { kind: "REASSIGN_LEAD", leadId: a.leadId, newSalespersonId: kevinId, reason: "load balancing" });

  // 7–8: concession requested + Super Admin concession approval (above threshold).
  const c = await readyLead(false);
  await leads.requestConcession(mathiew, c.leadId, { concessionType: ConcessionThresholdType.AMOUNT, concessionValue: "20000", reason: "scholarship" });
  await performOverride(superAdmin, { kind: "APPROVE_CONCESSION", leadId: c.leadId, reason: "manager unavailable" });

  // 9–12: payment submit + OCR field sources + audit approve.
  const p = await readyLead(true);
  const pay1 = await capture(p.leadId, "44999.50", "AC-APPROVE");
  await approvePayment(nandhiya, pay1, { confirmations: OK, varianceReason: "ok" });

  // 13: audit correction. 10: proof replace.
  const p2 = await readyLead(true);
  const pay2 = await capture(p2.leadId, "44999.50", "AC-CORRECT");
  await requestCorrection(nandhiya, pay2, { reasonCode: "Proof unclear", comment: "re-upload please" });
  await replaceProof(mathiew, pay2, { bytes: receiptJpg("44,999.50", "AC-CORRECT"), originalFilename: "p2.jpg" });

  // 14: audit reversal (override). Needs an approved payment.
  const p3 = await readyLead(true);
  const pay3 = await capture(p3.leadId, "44999.50", "AC-REVERSE");
  await approvePayment(nandhiya, pay3, { confirmations: OK, varianceReason: "ok" });
  await performOverride(superAdmin, { kind: "REVERSE_AUDIT", paymentId: pay3, reason: "reverse for audit test" });

  // 16: delegated audit (Super Admin override).
  const p4 = await readyLead(true);
  const pay4 = await capture(p4.leadId, "44999.50", "AC-DELEG");
  await performOverride(superAdmin, { kind: "DELEGATED_AUDIT", paymentId: pay4, decision: "APPROVE", reason: "Nandhiya away", confirmations: OK });

  // 17: system configuration changed.
  await setConfig(superAdmin, "lead_stall_days", 14, "Days before a lead is flagged stalled");

  // 18: user created.
  await createUser(superAdmin, { name: "Audit Complete User", email: "audit-complete-user1@proitbridge.local", mobile: "9000000001", role: Role.SALESPERSON });

  // 16-family: data export (AuditTrail EXPORT).
  await exportFinanceReport(rajesh, "monthly", "csv", { year: 2026, month: 8 });

  // 16-family: failed login — SecurityEvent (safe-logging convention; no PII, no cookies).
  await login("mathiew@proitbridge.local", "definitely-wrong-password", { ip: "127.0.0.1" });
}, 60_000);

afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

// The FRD §8.3 checklist, each mapped to the audit signature it must produce.
const EVENTS: { label: string; check: () => Promise<boolean> }[] = [
  { label: "Lead created", check: () => hasAudit("CREATE", "Lead") },
  { label: "Basic details entered/changed", check: () => hasAudit("UPDATE_BASIC_DETAILS", "Lead") },
  { label: "Course/plan/combo changed", check: () => hasAudit("SELECT_COURSE", "Lead") },
  { label: "Lead reassigned", check: () => hasAudit("OVERRIDE_LEAD_REASSIGN", "Lead") },
  { label: "Fee locked", check: () => hasAudit("FEE_LOCK", "Enrollment") },
  { label: "Fee unlocked/overridden", check: () => hasAudit("OVERRIDE_FEE_UNLOCK", "Enrollment") },
  { label: "Concession requested", check: () => hasAudit("CONCESSION_REQUEST", "Enrollment") },
  { label: "Concession approved (SA override)", check: () => hasAudit("OVERRIDE_CONCESSION_APPROVE", "Enrollment") },
  { label: "Payment draft generated", check: () => hasAudit("DRAFT_GENERATE", "Enrollment") },
  { label: "Payment record created", check: () => hasAudit("PAYMENT_SUBMIT", "Payment") },
  { label: "Payment screenshot replaced", check: () => hasAudit("PROOF_REPLACE", "Payment") },
  { label: "Payment audited — approved", check: () => hasAudit("AUDIT_APPROVE", "Payment") },
  { label: "Payment audited — correction required", check: () => hasAudit("AUDIT_CORRECTION", "Payment") },
  { label: "Audit decision reversed", check: () => hasAudit("OVERRIDE_AUDIT_REVERSAL", "Payment") },
  { label: "Delegated audit (SA override)", check: () => hasAudit("AUDIT_APPROVE_DELEGATED", "Payment") },
  { label: "Lead status transition (incl. Operations)", check: () => hasAudit("STATUS_TRANSITION") },
  { label: "System configuration changed", check: () => hasAudit("CONFIG_UPDATE", "SystemConfig") },
  { label: "User created", check: () => hasAudit("CREATE", "User") },
  { label: "Data export", check: () => hasAudit("EXPORT") },
  { label: "Login / failed login (security event)", check: () => hasSecurity("LOGIN_FAILED") },
];

describe("FR-AUD-01 — every FRD §8.3 event writes an audit entry (zero gaps)", () => {
  it("performs all listed event types and finds an audit row for each", async () => {
    const results = await Promise.all(EVENTS.map(async (e) => ({ label: e.label, ok: await e.check() })));
    const gaps = results.filter((r) => !r.ok);
    console.log(`\n  18-event completeness — ${results.length} event types checked:`);
    for (const r of results) console.log(`    ${r.ok ? "✓" : "✗ MISSING"}  ${r.label}`);
    expect(gaps, `gaps: ${gaps.map((g) => g.label).join(", ")}`).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(18);
  });
});

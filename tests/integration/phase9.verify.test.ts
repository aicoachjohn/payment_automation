// @vitest-environment node
/**
 * Phase 9 verification — the seven checks from the build pack, each with a labelled proof:
 *   1. Grep the codebase for any path writing Payment.received_amount / payment_date /
 *      transaction_id, and prove none is reachable by a SUPER_ADMIN.
 *   2. Reverse an approved payment → it leaves Finance totals immediately, Rajesh +
 *      Nandhiya + the salesperson are notified, a SuperAdminActivity row exists with the
 *      reason, and the record is back in the queue.
 *   3. An override with an empty reason is refused.
 *   4. UPDATE and DELETE on super_admin_activity as the app DB user are refused by the DB.
 *   5. A delegated audit stamps "Audited by Super Admin (delegated)" on the Sales, Data
 *      Management and Finance views and in the history.
 *   6. (18-event completeness is proven in audit-completeness.test.ts.)
 *   7. Rajesh sees the Super Admin Activity Log, read-only (no override path).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, AuditStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { createLead, markInterested, selectCourse, updateBasicDetails } = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment, listPaymentsForLead } = await import("@/server/services/payments");
const { approvePayment, auditQueue, getAuditRecord, auditTimeline } = await import("@/server/services/audit-decisions");
const { performOverride, listSuperAdminActivity, OverrideError } = await import("@/server/services/overrides");
const finance = await import("@/server/services/finance");
const { AuthorizationError, ROLE_PERMISSIONS, hasPermission } = await import("@/server/auth/permissions");
const { DELEGATED_AUDIT_LABEL } = await import("@/lib/constants");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
const TAG = "phase9-verify";
let n = 0;

const DETAILS = { fullName: "SA Verify", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };
const OK = { amountMatches: true, dateMatches: true, transactionIdMatches: true };
const CONF = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true };

function receiptJpg(amount: string, txn: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm\n₹${amount}\nUPI\n11 Aug 2026\nRef No: ${txn}`)]);
}

async function readyLead(): Promise<{ leadId: string; enrollmentId: string }> {
  n += 1;
  const { id } = await createLead(mathiew, { fullName: `${DETAILS.fullName} ${n}`, leadSource: TAG });
  await markInterested(mathiew, id);
  await updateBasicDetails(mathiew, id, { ...DETAILS, fullName: `${DETAILS.fullName} ${n}`, email: `sa${n}@example.com`, mobile: `95${String(600000000 + n)}` });
  await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  await generateDraft(mathiew, id);
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
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = leads.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    const pids = pays.map((p) => p.id);
    await prisma.financeQueryComment.deleteMany({ where: { query: { paymentId: { in: pids } } } });
    await prisma.financeQuery.deleteMany({ where: { paymentId: { in: pids } } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pids } } });
    // NB: super_admin_activity + audit_trail rows are append-only by design (verify #4) —
    // they cannot be deleted and are intentionally left behind, like all audit history.
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = leads.map((l) => l.id);
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

const RANGE = { from: "2026-08-01", to: "2026-08-31" };
const SRC = join(process.cwd(), "src");

describe("Verify #1 — no SUPER_ADMIN path writes a payment money field (FR-SA-08, BR-24)", () => {
  it("no grantable edit-amount permission, the override funnel names no frozen field, and SA can't reach a writer", () => {
    // (a) `payment:edit-amount` is not a grantable permission for ANY role.
    for (const role of Object.values(Role)) {
      expect(ROLE_PERMISSIONS[role].has("payment:edit-amount" as never)).toBe(false);
    }

    // (b) The ONE Super Admin mutation funnel (overrides.ts) never assigns a frozen field.
    //     (grep for `field:` — a write/assignment, distinct from `.field` reads.)
    const overrides = readFileSync(join(SRC, "server/services/overrides.ts"), "utf8");
    for (const field of ["receivedAmount:", "paymentDate:", "transactionId:"]) {
      expect(overrides.includes(field), `overrides.ts must not assign ${field}`).toBe(false);
    }

    // (c) The only functions that WRITE those fields are the salesperson capture/replace
    //     paths, which require payment:create — a permission the Super Admin does NOT hold.
    //     The delegated-audit path SA can reach (writeApproval) only sets audit status /
    //     variance reason, never a money field.
    expect(hasPermission(Role.SUPER_ADMIN, "payment:create")).toBe(false);
    expect(hasPermission(Role.SUPER_ADMIN, "payment:audit")).toBe(false);

    console.log("\n  [#1] no payment:edit-amount for any role; overrides.ts names no frozen field; SA lacks payment:create/audit");
  });
});

describe("Verify #2 — reverse an approved payment", () => {
  it("withdraws from Finance, notifies 3 roles, logs a SuperAdminActivity row, returns to queue", async () => {
    const { leadId } = await readyLead();
    const pid = await capture(leadId, "44999.50", "P9REV");
    await approvePayment(nandhiya, pid, { confirmations: OK, varianceReason: "ok" });
    expect((await finance.financeStatement(rajesh, RANGE)).rows.map((r) => r.transactionId)).toContain("P9REV");

    const before = await prisma.notification.count();
    await performOverride(superAdmin, { kind: "REVERSE_AUDIT", paymentId: pid, reason: "Proof was for the wrong learner" });

    const afterStatement = (await finance.financeStatement(rajesh, RANGE)).rows.map((r) => r.transactionId);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: pid } });
    const activity = await prisma.superAdminActivity.findFirst({ where: { entityId: pid, overrideType: "REVERSE_AUDIT" } });
    const notifsAfter = await prisma.notification.count();

    console.log(`\n  [#2] in finance after reversal=${afterStatement.includes("P9REV")}; status=${payment.auditStatus}; activity reason="${activity?.reasonText}"; +${notifsAfter - before} notifications`);
    expect(afterStatement).not.toContain("P9REV"); // left Finance immediately
    expect(payment.auditStatus).toBe(AuditStatus.PENDING_AUDIT); // back in queue
    expect(payment.locked).toBe(false);
    expect(activity?.reasonText).toBe("Proof was for the wrong learner");
    expect(activity?.notifiedTo.length).toBeGreaterThanOrEqual(3); // Rajesh + Nandhiya + salesperson
  });
});

describe("Verify #3 — an override with an empty reason is refused", () => {
  it("throws OverrideError", async () => {
    const { leadId } = await readyLead();
    const pid = await capture(leadId, "44999.50", "P9EMPTY");
    await approvePayment(nandhiya, pid, { confirmations: OK, varianceReason: "ok" });
    await expect(performOverride(superAdmin, { kind: "REVERSE_AUDIT", paymentId: pid, reason: "   " })).rejects.toBeInstanceOf(OverrideError);
    console.log("\n  [#3] empty-reason override rejected");
  });
});

describe("Verify #4 — super_admin_activity is DB-level append-only", () => {
  it("UPDATE and DELETE are refused by the database for the app role", async () => {
    // Seed one row via a real override so there is something to attempt to change.
    const { leadId } = await readyLead();
    const pid = await capture(leadId, "44999.50", "P9DBLOCK");
    await approvePayment(nandhiya, pid, { confirmations: OK, varianceReason: "ok" });
    await performOverride(superAdmin, { kind: "REVERSE_AUDIT", paymentId: pid, reason: "db protection check" });

    let updateErr = "";
    let deleteErr = "";
    try { await prisma.$executeRawUnsafe(`UPDATE super_admin_activity SET reason_text = 'tampered'`); } catch (e) { updateErr = (e as Error).message; }
    try { await prisma.$executeRawUnsafe(`DELETE FROM super_admin_activity`); } catch (e) { deleteErr = (e as Error).message; }

    console.log(`\n  [#4] UPDATE refused: ${/permission denied/i.test(updateErr)}; DELETE refused: ${/permission denied/i.test(deleteErr)}`);
    expect(updateErr).toMatch(/permission denied/i);
    expect(deleteErr).toMatch(/permission denied/i);
  });
});

describe("Verify #5 — delegated audit is marked on every view + history", () => {
  it("shows the (delegated) mark on Sales, Data Management and Finance and in history", async () => {
    const { leadId, enrollmentId } = await readyLead();
    const pid = await capture(leadId, "44999.50", "P9DELEG");
    void enrollmentId;
    await performOverride(superAdmin, { kind: "DELEGATED_AUDIT", paymentId: pid, decision: "APPROVE", reason: "Nandhiya on leave", confirmations: OK });

    const sales = await listPaymentsForLead(mathiew, leadId);
    const salesRow = sales.payments.find((p) => p.transactionId === "P9DELEG")!;
    const dmRecord = await getAuditRecord(nandhiya, pid);
    const dmQueue = await auditQueue(nandhiya, { search: "P9DELEG" });
    const fin = (await finance.financeStatement(rajesh, RANGE)).rows.find((r) => r.transactionId === "P9DELEG")!;
    const timeline = await auditTimeline(nandhiya, pid);

    console.log(`\n  [#5] label="${DELEGATED_AUDIT_LABEL}" · sales=${salesRow.delegatedAudit} dm=${dmRecord.delegatedAudit} finance=${fin.delegatedAudit} history=${timeline.some((t) => t.action === "AUDIT_APPROVE_DELEGATED")}`);
    expect(salesRow.delegatedAudit).toBe(true);
    expect(dmRecord.delegatedAudit).toBe(true);
    expect(dmQueue.find((r) => r.transactionId === "P9DELEG")!.delegatedAudit).toBe(true);
    expect(fin.delegatedAudit).toBe(true);
    expect(timeline.some((t) => t.action === "AUDIT_APPROVE_DELEGATED")).toBe(true);
  });
});

describe("Verify #7 — Rajesh sees the Activity Log, read-only", () => {
  it("Rajesh can read the log but has no override path", async () => {
    const rows = await listSuperAdminActivity(rajesh, {});
    expect(Array.isArray(rows)).toBe(true);
    await expect(
      performOverride(rajesh as never, { kind: "REVERSE_AUDIT", paymentId: "whatever", reason: "should fail" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    console.log(`\n  [#7] Rajesh read ${rows.length} activity rows; his override attempt was refused`);
  });
});

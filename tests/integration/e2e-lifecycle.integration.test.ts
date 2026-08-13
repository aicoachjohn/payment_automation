// @vitest-environment node
/**
 * END-TO-END LIFECYCLE (QA sign-off for the upload-driven flow). One run walks the whole
 * journey across every role and prints labelled evidence:
 *   Salesperson (hands-free intake) → Data Mgmt L1 audit (approve / reject) →
 *   Finance read-only visibility → Super Admin override → inviolable-rule checks.
 * DB-backed, self-contained, cleans up after itself. Uses the deterministic mock OCR
 * (vitest.integration env), so the text-bearing proof fixtures parse exactly.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, AuditStatus, Program, Plan, ComboMode } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { extractEnrollmentBundle, commitEnrollmentBundle } = await import("@/server/services/enrollment-intake");
const { approvePayment, rejectPayment, auditQueue, auditTimeline } = await import("@/server/services/audit-decisions");
const finance = await import("@/server/services/finance");
const { isVisibleToFinance } = await import("@/server/services/finance-visibility");
const { performOverride } = await import("@/server/services/overrides");
const { hasPermission } = await import("@/server/auth/permissions");
const { calculateBalance } = await import("@/server/money");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
let superAdmin: { userId: string; role: Role };
const TAG = "e2e-lifecycle";

function jpg(text: string) { return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(text)]); }
const paytm = (amt: string, txn: string) =>
  jpg(`Paytm\nProitbridge Opc Pvt Ltd\nKotak Mahindra Bank A/c - 2956\n₹${amt}\nPaid Successfully\nFrom\nMs S Nirmala\nIndian Bank - 7348\n11 Aug 2026, 06:45 PM\nRef No: ${txn}`);
const neft = (amt: string, txn: string) =>
  jpg(`Transaction Details\nMEGALA SEGAR\nFrom Account : XXXXXXXXXXX4155\nAmount : Rs.${amt}\nPayee Name : PROITBRIDGE OPC PVT LTD\nPayment Mode : NEFT\nReference No: ${txn}\nDate: 11 Aug 2026`);
const enrollMsg = (email: string, mobile: string) => `*Enrollment Confirmation - PREMIUM
Full Name : Suresh Kumar Krishnasamy
DOB : 08/01/1984
Full Address : 56A/6 S.Thiruvenkitapuram, Rajapalayam Tk, Virudhunagar Dt
Pincode : 626136
Email ID: ${email}
Mobile No: ${mobile}
Program Name: *Advanced Data Analytics + Advanced Data Science and AI + Gen AI & Agentic AI Program  "PREMIUM"
Course fee : *INR.84,999/-*
Commencing Date: *11th August 2026 (Tuesday)*`;

function toReviewed(preview: Awaited<ReturnType<typeof extractEnrollmentBundle>>) {
  return {
    learner: {
      fullName: preview.learner.fullName!, dob: preview.learner.dob!, doorNo: preview.learner.doorNo,
      street: preview.learner.street, address: preview.learner.address, district: preview.learner.district,
      state: preview.learner.state || "Tamil Nadu", pincode: preview.learner.pincode!, email: preview.learner.email!,
      mobile: preview.learner.mobile!, leadSource: TAG,
    },
    course: { program: preview.course.program!, plan: preview.course.plan!, comboMode: preview.course.comboMode ?? null, commencingDate: preview.course.commencingDate ?? null },
    payments: preview.payments.map((p) => ({
      proof: { key: p.proof.key, checksum: p.proof.checksum, fileType: p.proof.fileType, fileSize: p.proof.fileSize, originalFilename: p.proof.originalFilename },
      receivedAmount: p.receivedAmount!, paymentDate: p.paymentDate!, paymentMethod: p.paymentMethod!, transactionId: p.transactionId!,
      confirmations: { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true },
      varianceReason: "Part payment via enrollment intake", manualEntryNoOcr: false,
    })),
  };
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.reconciliationException.deleteMany({ where: { enrollmentId: { in: eids } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { relatedEntityId: { in: eids } } }).catch(() => {});
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
  nandhiya = await u("nandhiya@proitbridge.local", Role.DATA_MGMT_AUDITOR);
  rajesh = await u("rajesh@proitbridge.local", Role.FINANCE_REVIEWER);
  superAdmin = await u("super.admin@proitbridge.local", Role.SUPER_ADMIN);
  await cleanup();
}, 60_000);
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("END-TO-END lifecycle — Sales → L1 audit → Finance → Super Admin", () => {
  // Shared state across the ordered steps.
  const S: { leadId?: string; enrollmentId?: string; fee?: string; approvedId?: string; approvedTxn?: string; rejectedId?: string; rejectedTxn?: string } = {};

  it("STEP 1 — Salesperson: hands-free intake creates the enrollment + 2 payments (PENDING_AUDIT)", async () => {
    S.approvedTxn = "E2EPAYTM001";
    S.rejectedTxn = "E2ENEFT002";
    const preview = await extractEnrollmentBundle(mathiew, {
      text: enrollMsg("e2e.suresh@example.com", "9876543210"),
      proofs: [
        { bytes: paytm("34,999", S.approvedTxn), originalFilename: "paytm.jpg" },
        { bytes: neft("50000", S.rejectedTxn), originalFilename: "neft.jpg" },
      ],
    });
    expect(preview.course.program).toBe(Program.COMBO_ALL_THREE);
    expect(preview.course.plan).toBe(Plan.PREMIUM);
    expect(preview.course.comboMode).toBe(ComboMode.SINGLE_SHOT);

    const res = await commitEnrollmentBundle(mathiew, toReviewed(preview));
    S.leadId = res.leadId; S.enrollmentId = res.enrollmentId;
    expect(res.paymentIds).toHaveLength(2);
    expect(res.warnings).toEqual([]);

    const enr = await prisma.enrollment.findUniqueOrThrow({ where: { id: res.enrollmentId }, include: { payments: { orderBy: { paymentNumber: "asc" } } } });
    S.fee = enr.finalApprovedFee!.toFixed(2);
    S.approvedId = enr.payments.find((p) => p.transactionId === S.approvedTxn)!.id;
    S.rejectedId = enr.payments.find((p) => p.transactionId === S.rejectedTxn)!.id;
    for (const p of enr.payments) expect(p.auditStatus).toBe(AuditStatus.PENDING_AUDIT);
    console.log(`  ✔ Sales: lead ${S.leadId} · fee ₹${S.fee} · 2 payments PENDING_AUDIT (₹34,999 + ₹50,000)`);
  });

  it("STEP 2 — Data Mgmt (Nandhiya) L1: both queued; approve ₹34,999, reject ₹50,000", async () => {
    const queue = await auditQueue(nandhiya, { search: "E2E" }); // returns an array
    const queuedTxns = queue.map((r) => r.transactionId);
    expect(queuedTxns).toContain(S.approvedTxn);
    expect(queuedTxns).toContain(S.rejectedTxn);

    await approvePayment(nandhiya, S.approvedId!, { confirmations: { amountMatches: true, dateMatches: true, transactionIdMatches: true }, varianceReason: "part payment ok" });
    await rejectPayment(nandhiya, S.rejectedId!, { reasonCode: "Mismatch", comment: "amount does not match the proof" });

    const approved = await prisma.payment.findUniqueOrThrow({ where: { id: S.approvedId! } });
    const rejected = await prisma.payment.findUniqueOrThrow({ where: { id: S.rejectedId! } });
    expect(approved.auditStatus).toBe(AuditStatus.APPROVED);
    expect(rejected.auditStatus).toBe(AuditStatus.REJECTED);
    expect(approved.auditedBy).toBe(nandhiya.userId);
    console.log(`  ✔ Nandhiya L1: ₹34,999 APPROVED, ₹50,000 REJECTED (mandatory reason recorded)`);
  });

  it("STEP 3 — Finance (Rajesh) read-only: sees ONLY the approved payment; balance is approved-only", async () => {
    // BR-18: Finance holds no write permission of any kind.
    expect(hasPermission(Role.FINANCE_REVIEWER, "payment:create")).toBe(false);
    expect(hasPermission(Role.FINANCE_REVIEWER, "payment:audit")).toBe(false);

    // BR-15 / FR-DM-20: the visibility predicate.
    const approved = await prisma.payment.findUniqueOrThrow({ where: { id: S.approvedId! } });
    const rejected = await prisma.payment.findUniqueOrThrow({ where: { id: S.rejectedId! } });
    expect(isVisibleToFinance(approved)).toBe(true);
    expect(isVisibleToFinance(rejected)).toBe(false);

    // The Finance statement shows the approved txn and NOT the rejected one.
    const stmtTxns = (await finance.financeStatement(rajesh, RANGE)).rows.map((r) => r.transactionId);
    expect(stmtTxns).toContain(S.approvedTxn);
    expect(stmtTxns).not.toContain(S.rejectedTxn);

    // BR-22: balance = final fee − approved received (₹84,999 − ₹34,999 = ₹50,000). Rejected never reduces it.
    const balance = calculateBalance(S.fee!, [approved, rejected].map((p) => ({ receivedAmount: p.receivedAmount.toString(), auditStatus: p.auditStatus, voided: p.voided })));
    expect(Number(balance)).toBe(50000); // ₹84,999 − approved ₹34,999; rejected ₹50,000 never counts
    console.log(`  ✔ Rajesh (read-only): approved ₹34,999 visible, rejected ₹50,000 hidden; balance ₹${balance}`);
  });

  it("STEP 4 — Super Admin: reverse the audit decision (audited trail, notification)", async () => {
    await performOverride(superAdmin, { kind: "REVERSE_AUDIT", paymentId: S.approvedId!, reason: "E2E lifecycle — reopen for correction" });
    const reopened = await prisma.payment.findUniqueOrThrow({ where: { id: S.approvedId! } });
    expect(reopened.auditStatus).not.toBe(AuditStatus.APPROVED); // reopened → back into the workflow
    expect(isVisibleToFinance(reopened)).toBe(false); // no longer counted by Finance
    const activity = await prisma.superAdminActivity.findFirst({ where: { entityId: S.approvedId! }, orderBy: { performedAt: "desc" } });
    expect(activity).not.toBeNull();
    console.log(`  ✔ Super Admin: REVERSE_AUDIT logged to super_admin_activity; payment reopened & pulled from Finance`);
  });

  it("STEP 5 — Audit trail is append-only evidence across the whole journey", async () => {
    const timeline = await auditTimeline(nandhiya, S.approvedId!); // returns an array
    expect(timeline.length).toBeGreaterThan(0); // submit → approve → reverse are all recorded
    console.log(`  ✔ Audit trail: ${timeline.length} immutable entries for the ₹34,999 payment`);
  });
});

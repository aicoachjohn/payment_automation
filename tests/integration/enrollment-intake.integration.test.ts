// @vitest-environment node
/**
 * One-bundle enrollment intake — end to end. The sales team uploads only the "Enrollment
 * Confirmation" text + the payment proofs; the tool assembles Lead → basic details →
 * Enrollment → fee-locked draft → one Payment per proof (each PENDING_AUDIT). Validated
 * against the REAL sample: Suresh Kumar Krishnasamy / COMBO PREMIUM / ₹84,999 paid as
 * ₹34,999 (Paytm) + ₹50,000 (NEFT). Covers the assistive extract, the committed chain, and
 * the partial-failure (duplicate Txn) path.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, AuditStatus, ComboMode, PaymentMethod, Program, Plan } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { extractEnrollmentBundle, commitEnrollmentBundle, applyEnrollmentBundle } = await import("@/server/services/enrollment-intake");
const { createLead } = await import("@/server/services/leads");
type Preview = Awaited<ReturnType<typeof extractEnrollmentBundle>>;

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
const TAG = "enrollment-intake-it";

function jpg(text: string): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(text)]);
}
function paytmProof(amount: string, txn: string): Uint8Array {
  return jpg(
    `Paytm\nProitbridge Opc Pvt Ltd\nKotak Mahindra Bank A/c - 2956\n₹${amount}\nPaid Successfully\nFrom\nMs S Nirmala\nIndian Bank - 7348\n11 Aug 2026, 06:45 PM\nRef No: ${txn}`,
  );
}
function neftProof(amount: string, txn: string): Uint8Array {
  return jpg(
    `Transaction Details\nMEGALA SEGAR\nFrom Account : XXXXXXXXXXX4155\nAmount : Rs.${amount}\nPayee Name : PROITBRIDGE OPC PVT LTD\nPayment Mode : NEFT\nReference No: ${txn}\nDate: 11 Aug 2026`,
  );
}
function enrollmentText(email: string, mobile: string): string {
  return `Rajesh P
*Enrollment Confirmation - PREMIUM

Full Name : Suresh Kumar Krishnasamy
DOB : 08/01/1984
Full Address : 56A/6 S.Thiruvenkitapuram, Rajapalayam Tk, Virudhunagar Dt
Pincode : 626136
Email ID: ${email}
Mobile No: ${mobile}

Program Name: *Advanced Data Analytics + Advanced Data Science and AI + Gen AI & Agentic AI Program  "PREMIUM"

Course fee : *INR.84,999/-*

Commencing Date: *11th August 2026 (Tuesday)*`;
}

/** Turn the assistive preview into a reviewed+confirmed bundle (what the review screen posts). */
function toReviewed(preview: Preview) {
  return {
    learner: {
      fullName: preview.learner.fullName!,
      dob: preview.learner.dob!,
      doorNo: preview.learner.doorNo,
      street: preview.learner.street,
      address: preview.learner.address,
      district: preview.learner.district,
      state: preview.learner.state || "Tamil Nadu", // the one field the message never carries
      pincode: preview.learner.pincode!,
      email: preview.learner.email!,
      mobile: preview.learner.mobile!,
      leadSource: TAG,
    },
    course: {
      program: preview.course.program!,
      plan: preview.course.plan!,
      comboMode: preview.course.comboMode ?? null,
      commencingDate: preview.course.commencingDate ?? null,
    },
    payments: preview.payments.map((p) => ({
      proof: {
        key: p.proof.key,
        checksum: p.proof.checksum,
        fileType: p.proof.fileType,
        fileSize: p.proof.fileSize,
        originalFilename: p.proof.originalFilename,
      },
      receivedAmount: p.receivedAmount!,
      paymentDate: p.paymentDate!,
      paymentMethod: p.paymentMethod!,
      transactionId: p.transactionId!,
      confirmations: { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true },
      varianceReason: "Part payment via enrollment intake",
      manualEntryNoOcr: false,
    })),
  };
}

async function cleanup() {
  const leads = await prisma.lead.findMany({
    where: { leadSource: TAG },
    select: { id: true, enrollment: { select: { id: true } } },
  });
  const eids = leads.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  mathiew = {
    userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id,
    role: Role.SALESPERSON,
  };
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("enrollment intake — the real one-bundle flow", () => {
  it("extracts learner + program + both payments from the text and proofs", async () => {
    const preview = await extractEnrollmentBundle(mathiew, {
      text: enrollmentText("suresh.it1@example.com", "+1 4805226086"),
      proofs: [
        { bytes: paytmProof("34,999", "3122 4582 5686"), originalFilename: "paytm.jpg" },
        { bytes: neftProof("50000", "2DHERX1J5191"), originalFilename: "neft.jpg" },
      ],
    });

    expect(preview.learner.fullName).toBe("Suresh Kumar Krishnasamy");
    expect(preview.learner.dob?.slice(0, 10)).toBe("1984-01-08");
    expect(preview.learner.pincode).toBe("626136");
    expect(preview.learner.district).toBe("Virudhunagar");
    expect(preview.learner.mobile).toBe("+14805226086");

    // Program COMBO+PREMIUM; comboMode inferred SINGLE_SHOT by fee-matching ₹84,999.
    expect(preview.course.program).toBe(Program.COMBO_ALL_THREE);
    expect(preview.course.plan).toBe(Plan.PREMIUM);
    expect(preview.course.comboMode).toBe(ComboMode.SINGLE_SHOT);
    expect(preview.course.systemFee).toBe("84999.00");
    expect(preview.course.textCourseFee).toBe("84999");
    expect(preview.course.feeMismatch).toBe(false);

    // Two payments, each pre-filled from its proof's OCR.
    expect(preview.payments).toHaveLength(2);
    expect(preview.payments[0].receivedAmount).toBe("34999");
    expect(preview.payments[0].paymentMethod).toBe(PaymentMethod.UPI);
    expect(preview.payments[0].transactionId).toBe("312245825686");
    expect(preview.payments[1].receivedAmount).toBe("50000");
    expect(preview.payments[1].paymentMethod).toBe(PaymentMethod.NEFT);
    expect(preview.payments[1].transactionId).toBe("2DHERX1J5191");
  });

  it("commits the reviewed bundle into a lead + enrollment + two PENDING_AUDIT payments", async () => {
    const preview = await extractEnrollmentBundle(mathiew, {
      text: enrollmentText("suresh.it2@example.com", "9876500002"),
      proofs: [
        { bytes: paytmProof("34,999", "PAYTM20260811A"), originalFilename: "paytm.jpg" },
        { bytes: neftProof("50000", "NEFT20260811B"), originalFilename: "neft.jpg" },
      ],
    });
    const result = await commitEnrollmentBundle(mathiew, toReviewed(preview));

    expect(result.paymentIds).toHaveLength(2);
    expect(result.warnings).toEqual([]);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: result.leadId },
      include: { enrollment: { include: { payments: { include: { proofs: true }, orderBy: { paymentNumber: "asc" } } } } },
    });
    expect(lead.dob).not.toBeNull();
    expect(lead.pincode).toBe("626136");

    const enr = lead.enrollment!;
    expect(enr.program).toBe(Program.COMBO_ALL_THREE);
    expect(enr.plan).toBe(Plan.PREMIUM);
    expect(enr.comboMode).toBe(ComboMode.SINGLE_SHOT);
    expect(enr.finalApprovedFee?.toString()).toBe("84999");
    expect(enr.feeLockedAt).not.toBeNull();

    expect(enr.payments).toHaveLength(2);
    expect(enr.payments.map((p) => p.paymentNumber)).toEqual([1, 2]);
    for (const p of enr.payments) {
      expect(p.auditStatus).toBe(AuditStatus.PENDING_AUDIT); // Finance still sees nothing (rule #1)
      expect(p.proofs).toHaveLength(1);
      expect(p.proofs[0].version).toBe(1);
    }
    expect(enr.payments.map((p) => p.receivedAmount.toString()).sort()).toEqual(["34999", "50000"]);
  });

  it("keeps the first payment and warns when a later proof reuses a Transaction ID", async () => {
    const preview = await extractEnrollmentBundle(mathiew, {
      text: enrollmentText("suresh.it3@example.com", "9876500003"),
      proofs: [
        { bytes: paytmProof("34,999", "SAMETXN999"), originalFilename: "a.jpg" },
        { bytes: neftProof("50000", "SAMETXN999"), originalFilename: "b.jpg" },
      ],
    });
    const result = await commitEnrollmentBundle(mathiew, toReviewed(preview));

    expect(result.paymentIds).toHaveLength(1); // payment 1 persisted
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("SAMETXN999");

    const count = await prisma.payment.count({ where: { enrollmentId: (await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { enrollment: true } })).enrollment!.id } });
    expect(count).toBe(1);
  });

  it("applies a bundle to an EXISTING lead (lead-page auto-fill): basic + course + payments", async () => {
    // A bare lead created the manual way — no basic details, no enrollment yet.
    const { id: leadId } = await createLead(mathiew, { fullName: "Suresh Kumar Krishnasamy", leadSource: TAG });
    const preview = await extractEnrollmentBundle(mathiew, {
      text: enrollmentText("suresh.it4@example.com", "9876500004"),
      proofs: [
        { bytes: paytmProof("34,999", "APPLY20260811A"), originalFilename: "paytm.jpg" },
        { bytes: neftProof("50000", "APPLY20260811B"), originalFilename: "neft.jpg" },
      ],
    });
    const reviewed = toReviewed(preview);
    const result = await applyEnrollmentBundle(mathiew, leadId, reviewed);

    expect(result.leadId).toBe(leadId);
    expect(result.paymentIds).toHaveLength(2);
    expect(result.warnings).toEqual([]);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { enrollment: { include: { payments: true } } },
    });
    expect(lead.dob).not.toBeNull(); // basic details filled onto the pre-existing lead
    expect(lead.pincode).toBe("626136");
    expect(lead.enrollment?.finalApprovedFee?.toString()).toBe("84999");
    expect(lead.enrollment?.feeLockedAt).not.toBeNull();
    expect(lead.enrollment?.payments).toHaveLength(2);
    for (const p of lead.enrollment!.payments) expect(p.auditStatus).toBe(AuditStatus.PENDING_AUDIT);
  });

  it("captures a SINGLE partial proof (₹34,999 of ₹84,999) — no dropped payment, no re-upload", async () => {
    // Regression: a lone proof is a PART payment (variance vs the full fee). The review form
    // always pre-fills a variance reason, so this captures during intake instead of failing
    // and forcing a second upload on the lead page.
    const preview = await extractEnrollmentBundle(mathiew, {
      text: enrollmentText("suresh.single@example.com", "9876500005"),
      proofs: [{ bytes: paytmProof("34,999", "SINGLE20260811") }].map((p) => ({ ...p, originalFilename: "paytm.jpg" })),
    });
    expect(preview.payments).toHaveLength(1);
    const result = await commitEnrollmentBundle(mathiew, toReviewed(preview));

    expect(result.paymentIds).toHaveLength(1); // the partial payment WAS recorded
    expect(result.warnings).toEqual([]); // not dropped to a warning
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { enrollment: { include: { payments: true } } } });
    expect(lead.enrollment?.payments).toHaveLength(1);
    expect(lead.enrollment?.payments[0].receivedAmount.toString()).toBe("34999");
    expect(lead.enrollment?.payments[0].auditStatus).toBe(AuditStatus.PENDING_AUDIT);
  });
});

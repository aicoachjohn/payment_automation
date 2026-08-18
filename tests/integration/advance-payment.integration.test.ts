// @vitest-environment node
/**
 * Booking advances — the normal way a learner enrols.
 *
 * A lead almost never transfers the whole scheduled instalment up front; they pay a small
 * advance to hold the seat. Two things follow, and this suite pins both down:
 *
 *  1. The salesperson is not interrogated for it. Confirming a lead's screenshot needs the
 *     fee to be KNOWN, not locked, and an under-payment does not demand a written reason.
 *     A self-filled lead is auto-priced from the course it picked, so no course selection
 *     and no draft generation stand between the screenshot and the record.
 *  2. The money is still exactly right. The remainder stays outstanding (BR-22), nothing is
 *     written off, and Nandhiya still sees why the figure differs from the schedule.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PrismaClient, Role, Program, Plan, PaymentMethod, AuditStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { createIntakeInvite, submitIntake, listSelfProofs, confirmSelfProof } = await import("@/server/services/lead-intake-link");
const { listPaymentsForLead } = await import("@/server/services/payments");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const rawOf = (url: string) => url.split("/intake/")[1];
const createdLeadIds: string[] = [];
const tokenHashes: string[] = [];

function jpg(text: string) { return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(text)]); }
const strict = (email: string, mobile: string, program: Program) => ({
  fullName: "Advance Payer", dob: "1996-06-12", doorNo: "4B", street: "Anna Nagar", address: "4B Anna Nagar, Chennai",
  district: "Chennai", state: "Tamil Nadu", pincode: "600040", email, mobile,
  interestedProgram: program, interestedPlan: Plan.PREMIUM,
});

/** Submit a fresh self-intake carrying one payment screenshot; returns the new lead id. */
async function intakeWithProof(
  email: string,
  mobile: string,
  proofText: string,
  program: Program = Program.DATA_ANALYST,
): Promise<string> {
  const { url } = await createIntakeInvite(mathiew);
  const raw = rawOf(url);
  tokenHashes.push(sha256(raw));
  const res = await submitIntake(raw, strict(email, mobile, program), "203.0.113.11", [
    { bytes: jpg(proofText), originalFilename: "advance.jpg" },
  ]);
  expect(res.ok).toBe(true);
  const leadId = (await prisma.leadIntakeInvite.findUniqueOrThrow({ where: { tokenHash: sha256(raw) } })).createdLeadId!;
  createdLeadIds.push(leadId);
  return leadId;
}

async function cleanup() {
  for (const id of createdLeadIds) {
    const e = await prisma.enrollment.findUnique({ where: { leadId: id }, select: { id: true } });
    await prisma.leadSelfProof.deleteMany({ where: { leadId: id } });
    if (e) {
      const pays = await prisma.payment.findMany({ where: { enrollmentId: e.id }, select: { id: true } });
      await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
      await prisma.payment.deleteMany({ where: { enrollmentId: e.id } });
      await prisma.paymentDraft.deleteMany({ where: { enrollmentId: e.id } });
      await prisma.enrollment.delete({ where: { id: e.id } });
    }
    await prisma.lead.deleteMany({ where: { id } });
  }
  if (tokenHashes.length) await prisma.leadIntakeInvite.deleteMany({ where: { tokenHash: { in: tokenHashes } } });
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("a lead who books with an advance", () => {
  it("is auto-priced from its own course choice, so the salesperson selects nothing", async () => {
    const leadId = await intakeWithProof("adv1@example.com", "9700000101", "Paytm\n₹5,000\nPaid\nRef No: ADV20260818A");

    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { leadId } });
    expect(enrollment.program).toBe(Program.DATA_ANALYST);
    expect(enrollment.plan).toBe(Plan.PREMIUM);
    // Priced from the Pricing Master…
    expect(enrollment.finalApprovedFee).not.toBeNull();
    expect(Number(enrollment.finalApprovedFee!.toString())).toBeGreaterThan(0);
    // …but deliberately NOT locked, so the salesperson can still correct the course.
    expect(enrollment.feeLockedAt).toBeNull();
  });

  it("records the advance with no written reason, and leaves the rest outstanding", async () => {
    const leadId = await intakeWithProof("adv2@example.com", "9700000102", "Paytm\n₹5,000\nPaid\nRef No: ADV20260818B");
    const held = await listSelfProofs(mathiew, leadId);
    expect(held).toHaveLength(1);

    const fee = (await prisma.enrollment.findUniqueOrThrow({ where: { leadId } })).finalApprovedFee!.toString();

    // No selectCourse, no generateDraft — straight from screenshot to record, and crucially
    // NO varianceReason supplied even though ₹5,000 is far below the scheduled instalment.
    const result = await confirmSelfProof(mathiew, leadId, held[0].id, {
      receivedAmount: "5000.00",
      paymentDate: "2026-08-18T00:00:00.000Z",
      paymentMethod: PaymentMethod.UPI,
      transactionId: "ADV20260818B",
      confirmations: { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true },
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.auditStatus).toBe(AuditStatus.PENDING_AUDIT);
    expect(payment.receivedAmount.toString()).toBe("5000");

    // Nandhiya still gets told WHY it differs — the system writes the note, not the salesperson.
    expect(payment.varianceReason).toMatch(/advance \/ part payment/i);

    // The money is untouched: pending payments never reduce the balance (BR-22), so the
    // full fee is still outstanding until Nandhiya approves.
    const beforeApproval = await listPaymentsForLead(mathiew, leadId);
    expect(beforeApproval.balance).toBe(Number(fee).toFixed(2));
    expect(beforeApproval.payments[0].isPartPayment).toBe(true);

    // Once approved, the balance drops by exactly the advance — no more, no less.
    await prisma.payment.update({ where: { id: payment.id }, data: { auditStatus: AuditStatus.APPROVED } });
    const afterApproval = await listPaymentsForLead(mathiew, leadId);
    expect(afterApproval.balance).toBe((Number(fee) - 5000).toFixed(2));
  });

  it("still demands a reason when MORE than the balance is received (over-collection)", async () => {
    const leadId = await intakeWithProof("adv3@example.com", "9700000103", "Paytm\n₹5,000\nPaid\nRef No: ADV20260818C");
    const held = await listSelfProofs(mathiew, leadId);
    const fee = (await prisma.enrollment.findUniqueOrThrow({ where: { leadId } })).finalApprovedFee!.toString();

    // Pay MORE than the whole fee — the risky direction, so a reason stays mandatory.
    const over = (Number(fee) + 1000).toFixed(2);
    await expect(
      confirmSelfProof(mathiew, leadId, held[0].id, {
        receivedAmount: over,
        paymentDate: "2026-08-18T00:00:00.000Z",
        paymentMethod: PaymentMethod.UPI,
        transactionId: "ADV20260818C",
        confirmations: { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true },
      }),
    ).rejects.toThrow(/more than the learner still owes/i);
  });

  it("falls back to manual course selection for the Combo Pack, which needs a shot mode", async () => {
    // Single Shot vs Double Shot changes both the price and the instalment split, and the
    // intake form does not ask the learner for it — so a Combo lead cannot be auto-priced.
    // It must degrade gracefully: the lead is still created, just without an enrollment,
    // and the salesperson picks the course exactly as before.
    const leadId = await intakeWithProof(
      "adv4@example.com", "9700000104", "Paytm\n₹5,000\nPaid\nRef No: ADV20260818D", Program.COMBO_ALL_THREE,
    );
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.interestedProgram).toBe(Program.COMBO_ALL_THREE);
    expect(await prisma.enrollment.findUnique({ where: { leadId } })).toBeNull();
    // The proof is still held, waiting for the salesperson.
    expect(await listSelfProofs(mathiew, leadId)).toHaveLength(1);
  });
});

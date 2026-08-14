// @vitest-environment node
/**
 * The lead uploads a payment screenshot on the public intake form; it's HELD (not a payment).
 * The salesperson then confirms it (BR-20) into a real payment → PENDING_AUDIT. Verifies the
 * proof is held on submit and consumed on confirm. Uses the deterministic mock OCR.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PrismaClient, Role, Program, Plan, ComboMode, PaymentMethod, AuditStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { createIntakeInvite, submitIntake, listSelfProofs, confirmSelfProof } = await import("@/server/services/lead-intake-link");
const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const rawOf = (url: string) => url.split("/intake/")[1];
const createdLeadIds: string[] = [];
const tokenHashes: string[] = [];

function jpg(text: string) { return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(text)]); }
const strict = (email: string, mobile: string) => ({
  fullName: "Self Payer", dob: "1995-03-10", doorNo: "9C", street: "T Nagar", address: "9C T Nagar, Chennai",
  district: "Chennai", state: "Tamil Nadu", pincode: "600017", email, mobile,
  interestedProgram: Program.COMBO_ALL_THREE, interestedPlan: Plan.PREMIUM,
});

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

describe("lead-uploaded payment proof → salesperson confirms", () => {
  it("holds the proof on submit, then confirms it into a PENDING_AUDIT payment", async () => {
    const { url } = await createIntakeInvite(mathiew);
    const raw = rawOf(url);
    tokenHashes.push(sha256(raw));
    const proof = jpg("Paytm\nProitbridge Opc Pvt Ltd\n₹34,999\nPaid Successfully\n11 Aug 2026\nRef No: SELFPROOF20260811");

    const res = await submitIntake(raw, strict("selfpay1@example.com", "9700000011"), "203.0.113.9", [{ bytes: proof, originalFilename: "paytm.jpg" }]);
    expect(res.ok).toBe(true);
    const leadId = (await prisma.leadIntakeInvite.findUniqueOrThrow({ where: { tokenHash: sha256(raw) } })).createdLeadId!;
    createdLeadIds.push(leadId);

    // Held, not a payment yet.
    const held = await listSelfProofs(mathiew, leadId);
    expect(held).toHaveLength(1);
    expect(held[0].ocr.receivedAmount).toBe("34999");
    expect((await prisma.payment.count({ where: { enrollment: { leadId } } }))).toBe(0);

    // Salesperson sets the course + locks the fee, then confirms the held proof (BR-20).
    await leads.selectCourse(mathiew, leadId, { program: Program.COMBO_ALL_THREE, plan: Plan.PREMIUM, comboMode: ComboMode.SINGLE_SHOT });
    await generateDraft(mathiew, leadId);
    const result = await confirmSelfProof(mathiew, leadId, held[0].id, {
      receivedAmount: "34999",
      paymentDate: held[0].ocr.paymentDate!,
      paymentMethod: PaymentMethod.UPI,
      transactionId: "SELFPROOF20260811",
      confirmations: { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true },
      varianceReason: "part payment",
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId }, include: { proofs: true } });
    expect(payment.auditStatus).toBe(AuditStatus.PENDING_AUDIT);
    expect(payment.receivedAmount.toString()).toBe("34999");
    expect(payment.proofs).toHaveLength(1); // the held proof became a real PaymentProof

    // Consumed — no longer offered for confirmation.
    const consumed = await prisma.leadSelfProof.findUniqueOrThrow({ where: { id: held[0].id } });
    expect(consumed.consumedPaymentId).toBe(result.paymentId);
    expect(await listSelfProofs(mathiew, leadId)).toHaveLength(0);
  });
});

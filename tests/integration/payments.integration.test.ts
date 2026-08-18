// @vitest-environment node
/**
 * Phase 6 — payment capture, proof upload & OCR. Adversarial coverage: unconfirmed OCR
 * value blocked server-side (BR-20), duplicate Txn ID named (FR-SAL-43/BR-06), variance
 * needs a reason (FR-SAL-44), replaced proof keeps v1 (FR-SEC-26), signed-URL expiry and
 * ownership (FR-SEC-21).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod, AuditStatus, PaymentType } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { createLead, markInterested, selectCourse, updateBasicDetails } = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment, replaceProof, issueProofUrl } = await import("@/server/services/payments");
const { signProofToken, verifyProofToken } = await import("@/server/storage");
const { AuthorizationError } = await import("@/server/auth/permissions");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevin: { userId: string; role: Role };
const TAG = "phase6-it";
let counter = 0;

const DETAILS = {
  fullName: "Payer Lead", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area",
  district: "City", state: "State", pincode: "600001", email: "", mobile: "",
};

function receiptJpg(amount: string, txn: string): Uint8Array {
  const text = `Paytm\nProitbridge Opc Pvt Ltd\n₹${amount}\nPaid Successfully\nUPI\n11 Aug 2026\nRef No: ${txn}`;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(text)]);
}

async function readyLead(): Promise<string> {
  counter += 1;
  const { id } = await createLead(mathiew, { fullName: DETAILS.fullName, leadSource: TAG });
  await markInterested(mathiew, id);
  await updateBasicDetails(mathiew, id, { ...DETAILS, email: `payer${counter}@example.com`, mobile: `98${String(700000000 + counter)}` });
  await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  await generateDraft(mathiew, id); // locks the fee (89,999) + schedule 50/50 = 44,999.50 x2
  return id;
}

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
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
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  kevin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "kevin@proitbridge.local" } })).id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function captureInput(proof: Awaited<ReturnType<typeof uploadProof>>, txn: string, over: Partial<{ receivedAmount: string; confirmations: Record<string, boolean>; varianceReason: string }> = {}) {
  return {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: over.receivedAmount ?? "44999.50",
    paymentDate: new Date("2026-08-11").toISOString(),
    paymentMethod: PaymentMethod.UPI,
    transactionId: txn,
    confirmations: (over.confirmations as { receivedAmount: boolean; paymentDate: boolean; transactionId: boolean; paymentMethod: boolean }) ?? { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true },
    varianceReason: over.varianceReason,
    manualEntryNoOcr: false,
  };
}

describe("#1 — an unconfirmed OCR value is refused server-side (BR-20)", () => {
  it("received amount left unconfirmed → rejected", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "TXNP6UNCONF1"), originalFilename: "proof.jpg" });
    expect(proof.ocr.fields.receivedAmount).toBe("44999.50"); // OCR extracted it
    await expect(
      capturePayment(mathiew, id, captureInput(proof, "TXNP6UNCONF1", { confirmations: { receivedAmount: false, paymentDate: true, transactionId: true, paymentMethod: true } })),
    ).rejects.toThrow(/confirm the extracted received amount/i);
  });
});

describe("capture succeeds with confirmation, PENDING_AUDIT, system-derived fields", () => {
  it("payment #1 = COURSE_HOLDING, PENDING_AUDIT, expected from schedule", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "TXNP6OK0001"), originalFilename: "proof.jpg" });
    const res = await capturePayment(mathiew, id, captureInput(proof, "TXNP6OK0001"));
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: res.paymentId }, include: { proofs: true } });
    expect(payment.paymentNumber).toBe(1);
    expect(payment.paymentType).toBe(PaymentType.COURSE_HOLDING);
    expect(payment.auditStatus).toBe(AuditStatus.PENDING_AUDIT);
    expect(payment.expectedAmount.toFixed(2)).toBe("44999.50");
    expect((payment.fieldSources as Record<string, string>).receivedAmount).toBe("OCR");
    expect(payment.proofs).toHaveLength(1);
  });
});

describe("#2 — duplicate Transaction ID is rejected and names the conflicting lead", () => {
  it("second capture with the same Txn ID names the first lead + payment #", async () => {
    const a = await readyLead();
    const pa = await uploadProof(mathiew, a, { bytes: receiptJpg("44,999.50", "TXNP6DUP001"), originalFilename: "a.jpg" });
    await capturePayment(mathiew, a, captureInput(pa, "TXNP6DUP001"));

    const b = await readyLead();
    const pb = await uploadProof(mathiew, b, { bytes: receiptJpg("44,999.50", "TXNP6DUP001"), originalFilename: "b.jpg" });
    await expect(capturePayment(mathiew, b, captureInput(pb, "TXNP6DUP001"))).rejects.toThrow(/already recorded on lead "Payer Lead" \(payment #1\)/);
  });
});

describe("#3 — variance: an advance is routine, over-collection is not (FR-SAL-44)", () => {
  // Fee 89,999 on a 50/50 schedule, so payment #1 expects 44,999.50.
  it("UNDER expected with no reason → recorded, with a system-written note", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("30,000", "TXNP6VAR001"), originalFilename: "p.jpg" });
    // A learner booking with a ₹30,000 advance must not stop the salesperson for an essay.
    const res = await capturePayment(mathiew, id, captureInput(proof, "TXNP6VAR001", { receivedAmount: "30000" }));
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    // Nandhiya is still told why it differs — the system writes it, not the salesperson.
    expect(p.varianceReason).toMatch(/advance \/ part payment/i);
  });

  it("keeps the salesperson's own wording when they do explain it", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("30,000", "TXNP6VAR002"), originalFilename: "p.jpg" });
    const res = await capturePayment(mathiew, id, captureInput(proof, "TXNP6VAR002", { receivedAmount: "30000", varianceReason: "Partial holding amount" }));
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(p.varianceReason).toBe("Partial holding amount");
  });

  it("ABOVE the instalment but within the balance → recorded, no reason needed", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("50,000", "TXNP6VAR003"), originalFilename: "p.jpg" });
    // 50,000 exceeds the 44,999.50 instalment but is well inside the 89,999 owed — the
    // learner is simply paying ahead, which is no more suspicious than paying an advance.
    const res = await capturePayment(mathiew, id, captureInput(proof, "TXNP6VAR003", { receivedAmount: "50000" }));
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(p.receivedAmount.toString()).toBe("50000");
  });

  it("ABOVE the outstanding balance with no reason → rejected (over-collection)", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("95,000", "TXNP6VAR004"), originalFilename: "p.jpg" });
    // 95,000 against a 89,999 fee is the one genuinely risky case (BR-14). Nandhiya blocks
    // it at approval (FR-REC-04); capture still insists the salesperson says why.
    await expect(
      capturePayment(mathiew, id, captureInput(proof, "TXNP6VAR004", { receivedAmount: "95000" })),
    ).rejects.toThrow(/more than the learner still owes/i);
    const res = await capturePayment(mathiew, id, captureInput(proof, "TXNP6VAR004", { receivedAmount: "95000", varianceReason: "Learner overpaid; refund agreed" }));
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(p.varianceReason).toBe("Learner overpaid; refund agreed");
  });
});

describe("#4 — replaced proof creates a new version, v1 retained (FR-SEC-26)", () => {
  it("replaceProof → v2 while v1 stays", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "TXNP6REPL01"), originalFilename: "p.jpg" });
    const res = await capturePayment(mathiew, id, captureInput(proof, "TXNP6REPL01"));
    const rep = await replaceProof(mathiew, res.paymentId, { bytes: receiptJpg("44,999.50", "ignored"), originalFilename: "p2.jpg" });
    expect(rep.version).toBe(2);
    const proofs = await prisma.paymentProof.findMany({ where: { paymentId: res.paymentId }, orderBy: { version: "asc" } });
    expect(proofs.map((p) => p.version)).toEqual([1, 2]); // both retained
  });
});

describe("#5 — signed URL: ownership + expiry (FR-SEC-21)", () => {
  it("owner gets a URL; a non-owner is refused; an expired token fails verification", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "TXNP6URL001"), originalFilename: "p.jpg" });
    const res = await capturePayment(mathiew, id, captureInput(proof, "TXNP6URL001"));
    const proofRow = await prisma.paymentProof.findFirstOrThrow({ where: { paymentId: res.paymentId } });

    const url = await issueProofUrl(mathiew, proofRow.id);
    expect(url).toContain(`/api/proofs/${proofRow.id}?token=`);

    await expect(issueProofUrl(kevin, proofRow.id)).rejects.toBeInstanceOf(AuthorizationError);

    const valid = signProofToken(proofRow.id, Date.now() + 60_000);
    const expired = signProofToken(proofRow.id, Date.now() - 1_000);
    expect(verifyProofToken(proofRow.id, valid)).toBe(true);
    expect(verifyProofToken(proofRow.id, expired)).toBe(false);
    expect(verifyProofToken(proofRow.id, valid + "a")).toBe(false); // tampered
  });
});

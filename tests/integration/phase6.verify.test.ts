// @vitest-environment node
/**
 * Phase 6 verification — the six adversarial checks from the build pack:
 *   1. A payment with an OCR-extracted amount that was never confirmed → refused server-side.
 *   2. Reusing a Transaction ID from another lead → error names that lead and payment.
 *   3. A text file renamed to proof.jpg → rejected on content.
 *   4. A proof's signed URL past its expiry → fails.
 *   5. A salesperson who does not own the lead requesting the proof URL → refused.
 *   6. Replacing a proof → version 1 is still retained and viewable.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, PaymentMethod } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";

const { createLead, markInterested, selectCourse, updateBasicDetails } = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment, replaceProof, issueProofUrl, getProofForActor } = await import("@/server/services/payments");
const { signProofToken, verifyProofToken } = await import("@/server/storage");
const { AuthorizationError } = await import("@/server/auth/permissions");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevin: { userId: string; role: Role };
const TAG = "phase6-verify";
let n = 0;

const DETAILS = { fullName: "Proof Payer", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "", mobile: "" };

function receiptJpg(amount: string, txn: string): Uint8Array {
  const text = `Paytm\n₹${amount}\nUPI\n11 Aug 2026\nRef No: ${txn}`;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(text)]);
}

async function readyLead(): Promise<string> {
  n += 1;
  const { id } = await createLead(mathiew, { fullName: DETAILS.fullName, leadSource: TAG });
  await markInterested(mathiew, id);
  await updateBasicDetails(mathiew, id, { ...DETAILS, email: `proof${n}@example.com`, mobile: `98${String(600000000 + n)}` });
  await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  await generateDraft(mathiew, id);
  return id;
}

function input(proof: Awaited<ReturnType<typeof uploadProof>>, txn: string, confirmations = { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true }) {
  return {
    proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
    receivedAmount: "44999.50", paymentDate: new Date("2026-08-11").toISOString(), paymentMethod: PaymentMethod.UPI,
    transactionId: txn, confirmations, manualEntryNoOcr: false as boolean,
  };
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
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  kevin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "kevin@proitbridge.local" } })).id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("#1 — unconfirmed OCR value refused server-side", () => {
  it("received amount extracted by OCR but left unconfirmed → rejected", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "V6UNCONF01"), originalFilename: "proof.jpg" });
    let msg = "";
    try {
      await capturePayment(mathiew, id, input(proof, "V6UNCONF01", { receivedAmount: false, paymentDate: true, transactionId: true, paymentMethod: true }));
    } catch (e) { msg = (e as Error).message; }
    console.log(`\n  OCR amount extracted (${proof.ocr.fields.receivedAmount}) but unconfirmed → "${msg}"`);
    expect(msg).toMatch(/confirm the extracted received amount/i);
  });
});

describe("#2 — duplicate Transaction ID names the conflicting lead + payment", () => {
  it("second capture with the same Txn ID is rejected with the lead name and payment #", async () => {
    const a = await readyLead();
    const pa = await uploadProof(mathiew, a, { bytes: receiptJpg("44,999.50", "V6DUP0001"), originalFilename: "a.jpg" });
    await capturePayment(mathiew, a, input(pa, "V6DUP0001"));
    const b = await readyLead();
    const pb = await uploadProof(mathiew, b, { bytes: receiptJpg("44,999.50", "V6DUP0001"), originalFilename: "b.jpg" });
    let msg = "";
    try { await capturePayment(mathiew, b, input(pb, "V6DUP0001")); } catch (e) { msg = (e as Error).message; }
    console.log(`  duplicate Txn ID → "${msg}"`);
    expect(msg).toMatch(/already recorded on lead "Proof Payer" \(payment #1\)/);
  });
});

describe("#3 — a text file renamed to .jpg is rejected on content", () => {
  it("uploadProof rejects a text file even with a .jpg name", async () => {
    const id = await readyLead();
    const textBytes = new TextEncoder().encode("this is not an image, it is plain text pretending to be a jpg");
    let msg = "";
    try { await uploadProof(mathiew, id, { bytes: textBytes, originalFilename: "proof.jpg" }); } catch (e) { msg = (e as Error).message; }
    console.log(`  text renamed to proof.jpg → "${msg}"`);
    expect(msg).toMatch(/Only JPG, PNG or PDF/);
  });
});

describe("#4 — a signed URL past its expiry fails", () => {
  it("verifyProofToken rejects an expired (and tampered) token", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "V6EXP0001"), originalFilename: "p.jpg" });
    const res = await capturePayment(mathiew, id, input(proof, "V6EXP0001"));
    const row = await prisma.paymentProof.findFirstOrThrow({ where: { paymentId: res.paymentId } });
    const valid = signProofToken(row.id, Date.now() + 60_000);
    const expired = signProofToken(row.id, Date.now() - 1_000);
    console.log(`  valid token accepted: ${verifyProofToken(row.id, valid)} | expired token accepted: ${verifyProofToken(row.id, expired)}`);
    expect(verifyProofToken(row.id, valid)).toBe(true);
    expect(verifyProofToken(row.id, expired)).toBe(false); // → route returns 403
    expect(verifyProofToken(row.id, valid.replace(/.$/, "0"))).toBe(false); // tampered
  });
});

describe("#5 — a non-owner salesperson is refused the proof URL", () => {
  it("Kevin cannot issue a URL for, or access, Mathiew's proof", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "V6OWN0001"), originalFilename: "p.jpg" });
    const res = await capturePayment(mathiew, id, input(proof, "V6OWN0001"));
    const row = await prisma.paymentProof.findFirstOrThrow({ where: { paymentId: res.paymentId } });

    let issueRefused = false, accessRefused = false;
    try { await issueProofUrl(kevin, row.id); } catch (e) { issueRefused = e instanceof AuthorizationError; }
    try { await getProofForActor(kevin, row.id); } catch (e) { accessRefused = e instanceof AuthorizationError; }
    console.log(`  Kevin issue-URL refused: ${issueRefused} | Kevin direct-access refused: ${accessRefused}`);
    expect(issueRefused).toBe(true);
    expect(accessRefused).toBe(true);
    // The owner can.
    expect(await issueProofUrl(mathiew, row.id)).toContain(`/api/proofs/${row.id}?token=`);
  });
});

describe("#6 — replacing a proof keeps version 1 viewable", () => {
  it("replaceProof → v2, and v1 is retained in history", async () => {
    const id = await readyLead();
    const proof = await uploadProof(mathiew, id, { bytes: receiptJpg("44,999.50", "V6REPL001"), originalFilename: "p.jpg" });
    const res = await capturePayment(mathiew, id, input(proof, "V6REPL001"));
    const rep = await replaceProof(mathiew, res.paymentId, { bytes: receiptJpg("44,999.50", "x"), originalFilename: "p2.jpg" });
    const proofs = await prisma.paymentProof.findMany({ where: { paymentId: res.paymentId }, orderBy: { version: "asc" } });
    const v1 = await getProofForActor(mathiew, proofs[0].id);
    console.log(`  proof versions after replace: [${proofs.map((p) => p.version).join(", ")}] | v1 still viewable: ${v1?.version === 1}`);
    expect(rep.version).toBe(2);
    expect(proofs.map((p) => p.version)).toEqual([1, 2]);
    expect(v1?.version).toBe(1);
  });
});

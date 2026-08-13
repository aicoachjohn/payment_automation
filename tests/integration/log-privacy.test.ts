// @vitest-environment node
/**
 * FR-SEC-31 — personal data, payment AMOUNTS, Transaction IDs and auth/proof TOKENS must
 * appear in no application log. This runs a full capture → approve → sign-proof-URL →
 * export flow with distinctive sentinel values, captures everything written to the
 * console, and asserts none of the sensitive values leaked. (The dev console EMAIL
 * provider is a local-only convenience and is disabled here via EMAIL_PROVIDER=stub.)
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, Role, PaymentMethod } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();
process.env.PROOF_SIGNING_SECRET = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET ?? "test-proof-signing-secret-000000";
process.env.EMAIL_PROVIDER = "stub"; // no dev-console email body printing

const leads = await import("@/server/services/leads");
const { generateDraft } = await import("@/server/services/draft");
const { uploadProof, capturePayment, issueProofUrl } = await import("@/server/services/payments");
const { approvePayment } = await import("@/server/services/audit-decisions");
const { exportFinanceReport } = await import("@/server/services/finance-export");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let nandhiya: { userId: string; role: Role };
let rajesh: { userId: string; role: Role };
const TAG = "logpriv";

// Distinctive sentinels — if any of these appears in a log line, that is a leak.
const AMOUNT = "44999.53";
const AMOUNT_GROUPED = "44,999.53";
const TXN = "LOGPRIV-SECRET-TXN-9931";

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = rows.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) {
    const pays = await prisma.payment.findMany({ where: { enrollmentId: { in: eids } }, select: { id: true } });
    await prisma.securityEvent.deleteMany({ where: { details: { path: ["proofId"], not: undefined } } }).catch(() => {});
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId: { in: eids } } });
    await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  }
  const ids = rows.map((l) => l.id);
  if (ids.length) { await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } }); await prisma.lead.deleteMany({ where: { id: { in: ids } } }); }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  nandhiya = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "nandhiya@proitbridge.local" } })).id, role: Role.DATA_MGMT_AUDITOR };
  rajesh = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "rajesh@proitbridge.local" } })).id, role: Role.FINANCE_REVIEWER };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("FR-SEC-31 — no amount / Txn ID / token in the application log", () => {
  it("a full money flow logs none of the sensitive values", async () => {
    const captured: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { captured.push(args.map(String).join(" ")); }),
    );

    let proofUrl = "";
    try {
      const { id } = await leads.createLead(mathiew, { fullName: "Log Privacy", leadSource: TAG });
      await leads.markInterested(mathiew, id);
      await leads.updateBasicDetails(mathiew, id, { fullName: "Log Privacy", dob: "1990-02-02", doorNo: "1", street: "St", address: "Area", district: "City", state: "State", pincode: "600001", email: "logpriv@example.com", mobile: "9876500011" });
      await leads.selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
      await generateDraft(mathiew, id);
      const proof = await uploadProof(mathiew, id, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`Paytm ${TXN}`)]), originalFilename: "p.jpg" });
      const cap = await capturePayment(mathiew, id, {
        proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
        receivedAmount: AMOUNT, paymentDate: new Date("2026-08-12").toISOString(), paymentMethod: PaymentMethod.UPI,
        transactionId: TXN, confirmations: { receivedAmount: true, paymentDate: true, transactionId: true, paymentMethod: true }, varianceReason: "seed", manualEntryNoOcr: false,
      });
      await approvePayment(nandhiya, cap.paymentId, { confirmations: { amountMatches: true, dateMatches: true, transactionIdMatches: true }, varianceReason: "ok" });
      const proofRow = await prisma.paymentProof.findFirstOrThrow({ where: { paymentId: cap.paymentId } });
      proofUrl = await issueProofUrl(mathiew, proofRow.id);
      await exportFinanceReport(rajesh, "statement", "csv", { statement: { from: "2026-08-01", to: "2026-08-31" } });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }

    const log = captured.join("\n");
    const proofToken = new URL(proofUrl, "http://x").searchParams.get("token") ?? "TOKEN_MISSING";

    // The flow executed (sanity: the proof URL was actually issued).
    expect(proofUrl).toMatch(/\/api\/proofs\//);
    // …and none of the sensitive values reached the log.
    expect(log).not.toContain(AMOUNT);
    expect(log).not.toContain(AMOUNT_GROUPED);
    expect(log).not.toContain(TXN);
    expect(log).not.toContain(proofToken);
    expect(log).not.toContain("9876500011"); // mobile (personal data)
  });
});

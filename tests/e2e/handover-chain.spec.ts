/**
 * NOTE: the waits here are generous (60s). These are the first requests to hit each server
 * action in a dev build, and Next compiles them on demand — a cold route can take well over
 * the usual 15s. It is compile latency, not the app being slow.
 *
 * The handover chain, driven through the real screens: Sales submit to Nandhiya, Nandhiya
 * approves the payment, Nandhiya passes it to Finance.
 *
 * The specific regression this guards is the one the business hit: Sales pressing the button
 * and getting "at least one approved payment; an outstanding balance remains" — two things
 * they cannot fix. Here Sales must succeed with the payment still pending and money still
 * owed, and see a message naming Nandhiya.
 */
import { test, expect, type Page } from "@playwright/test";
import { Role, PaymentMethod, AuditStatus } from "@prisma/client";
import { copyFileSync, readdirSync, rmSync } from "node:fs";
import { prisma, ensureUser, cleanupUser, type E2EUser } from "./helpers/db";

const SALES: E2EUser = { email: "e2e.chain.sales@proitbridge.local", password: "Test#Chain1", role: Role.SALESPERSON, twoFa: false };
const AUDIT: E2EUser = { email: "e2e.chain.audit@proitbridge.local", password: "Test#Chain2", role: Role.DATA_MGMT_AUDITOR, twoFa: false };
const FIN: E2EUser = { email: "e2e.chain.fin@proitbridge.local", password: "Test#Chain3", role: Role.FINANCE_REVIEWER, twoFa: false };

let salesId = "";
let auditId = "";
let leadId = "";
let enrollmentId = "";
let proofPath = "";

async function login(page: Page, u: E2EUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/login\/otp|\/sales|\/audit|\/finance/, { timeout: 60_000 });
  if (new URL(page.url()).pathname === "/login/otp") {
    await page.getByLabel("6-digit code").fill(process.env.E2E_FIXED_OTP ?? "000000");
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

test.beforeAll(async () => {
  salesId = await ensureUser(SALES);
  auditId = await ensureUser(AUDIT);
  await ensureUser(FIN);

  const existing = readdirSync(".proof-storage/proofs").filter((f) => !f.endsWith(".ocr.json"))[0];
  const key = `proofs/chain-e2e-${process.pid}`;
  proofPath = `.proof-storage/${key}`;
  copyFileSync(`.proof-storage/proofs/${existing}`, proofPath);

  const pricing = await prisma.pricingMaster.findFirstOrThrow({ where: { program: "DATA_ANALYST" } });
  const lead = await prisma.lead.create({
    data: {
      fullName: "Chain Learner", dob: new Date("1996-04-04"), doorNo: "3", street: "Adyar",
      address: "3 Adyar, Chennai", district: "Chennai", state: "Tamil Nadu", pincode: "600020",
      email: "chain@example.com", mobile: "9700000177",
      interestedProgram: "DATA_ANALYST", interestedPlan: "PREMIUM",
      leadSource: "Self-intake link", salespersonId: salesId, status: "BASIC_DETAILS_RECEIVED",
    },
  });
  leadId = lead.id;

  const enrollment = await prisma.enrollment.create({
    data: {
      leadId, program: "DATA_ANALYST", plan: "PREMIUM", pricingId: pricing.id,
      standardFee: "29999.00", baseFee: "25423.73", gstAmount: "4575.27", gstPercent: "18.00",
      finalApprovedFee: "29999.00", commencingDate: new Date("2026-09-01"),
    },
  });
  enrollmentId = enrollment.id;

  // A PART payment, still PENDING — so a balance remains AND nothing is approved. Under the
  // old rule this combination made the Sales button impossible to satisfy.
  const payment = await prisma.payment.create({
    data: {
      enrollmentId, paymentNumber: 1, paymentType: "COURSE_HOLDING",
      expectedAmount: "11999.60", receivedAmount: "5000.00",
      paymentDate: new Date("2026-08-20"), paymentMethod: PaymentMethod.UPI,
      transactionId: `CHAIN-E2E-${process.pid}`, auditStatus: AuditStatus.PENDING_AUDIT,
      submittedBy: salesId, manualEntryNoOcr: true, fieldSources: {},
    },
  });
  await prisma.paymentProof.create({
    data: {
      paymentId: payment.id, version: 1, filePath: key, fileType: "image/jpeg", fileSize: 2048,
      uploadedBy: salesId, checksumSha256: "0".repeat(64), originalFilename: "proof.jpg",
      virusScanStatus: "CLEAN",
    },
  });
});

test.afterAll(async () => {
  if (enrollmentId) {
    await prisma.operationsHandover.deleteMany({ where: { enrollmentId } });
    const pays = await prisma.payment.findMany({ where: { enrollmentId }, select: { id: true } });
    await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { enrollmentId } });
    await prisma.enrollment.delete({ where: { id: enrollmentId } });
  }
  if (leadId) {
    await prisma.notification.deleteMany({ where: { relatedEntityId: { in: [leadId, enrollmentId] } } });
    await prisma.lead.delete({ where: { id: leadId } });
  }
  if (proofPath) rmSync(proofPath, { force: true });
  await cleanupUser(SALES.email);
  await cleanupUser(AUDIT.email);
  await cleanupUser(FIN.email);
  await prisma.$disconnect();
});

test("Sales hand over to Nandhiya, who approves and hands over to Finance", async ({ page }) => {
  // ── Stage 1: Sales ────────────────────────────────────────────────────────
  await login(page, SALES);
  await page.goto(`/leads/${leadId}`);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: /Submit handover to Nandhiya/i }).click();
  await expect(page.getByText(/Handed over to Nandhiya/i)).toBeVisible({ timeout: 60_000 });

  const h = await prisma.operationsHandover.findFirstOrThrow({ where: { enrollmentId } });
  expect(h.stage).toBe("WITH_DATA_MGMT");

  // ── Stage 2: Nandhiya, from her AUDIT record — not a separate Handovers tab ────
  await page.goto("/login");
  await login(page, AUDIT);
  const payment0 = await prisma.payment.findFirstOrThrow({ where: { enrollmentId } });
  await page.goto(`/audit/${payment0.id}`);
  await page.waitForLoadState("networkidle");

  // The handover action lives on the record she is auditing, so she never leaves it.
  await expect(page.getByRole("heading", { name: /^Handover$/ })).toBeVisible();

  // She cannot pass it on yet — the payment is still awaiting her decision.
  await expect(page.getByText(/Audit decision on payment #1/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Hand over to Rajesh/i })).toBeDisabled();

  // Approve the payment, then the button opens up. Set directly rather than through the
  // approval screen: Playwright cannot import "server-only" modules, and the approval gate
  // itself is covered in tests/integration/audit.integration.test.ts. What THIS test is
  // about is what the chain does either side of that decision.
  const payment = await prisma.payment.findFirstOrThrow({ where: { enrollmentId } });
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      auditStatus: AuditStatus.APPROVED, auditedBy: auditId, auditedAt: new Date(),
      locked: true, varianceReason: "Advance accepted",
    },
  });

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Hand over to Rajesh/i }).click();
  // Server-rendered, so the confirmation survives the refresh that unmounts the panel.
  await expect(page.getByText(/Handed over to Rajesh/i).first()).toBeVisible({ timeout: 60_000 });

  const after = await prisma.operationsHandover.findUniqueOrThrow({ where: { id: h.id } });
  expect(after.stage).toBe("WITH_FINANCE");

  // The balance is STILL outstanding — proving Finance receives it on Nandhiya's approval,
  // not on the money being complete.
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
  expect(Number(e.finalApprovedFee)).toBeGreaterThan(5000);

  // ── Stage 3: Rajesh ───────────────────────────────────────────────────────
  await page.goto("/login");
  await login(page, FIN);
  await page.goto(`/handover/${h.id}`);
  await page.waitForLoadState("networkidle");

  // He sends it back first, with a reason — it must land on Nandhiya's desk again.
  await page.getByRole("button", { name: /Send back to Data Management/i }).click();
  await page.getByPlaceholder(/What does Data Management need to correct/i).fill("Proof is unreadable");
  await page.getByRole("button", { name: /Confirm — send it back/i }).click();
  await expect(page.getByText(/Sent back to Data Management/i)).toBeVisible({ timeout: 60_000 });
  expect((await prisma.operationsHandover.findUniqueOrThrow({ where: { id: h.id } })).stage).toBe("WITH_DATA_MGMT");

  // Nandhiya passes it back, and this time he approves.
  await prisma.operationsHandover.update({ where: { id: h.id }, data: { stage: "WITH_FINANCE" } });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Approve$/ }).click();
  // The confirmation must survive the refresh that unmounts the decision panel — otherwise
  // Rajesh clicks Approve and is shown nothing.
  await expect(page.getByText(/Approved by Finance/i).first()).toBeVisible({ timeout: 60_000 });
  expect((await prisma.operationsHandover.findUniqueOrThrow({ where: { id: h.id } })).stage).toBe("FINANCE_APPROVED");
});

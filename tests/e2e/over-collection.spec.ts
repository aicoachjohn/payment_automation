/**
 * Over-collection is the ONE case where the salesperson is still asked to explain a figure,
 * so the screen has to say plainly WHERE to write it. This drives the real thing: a ₹34,999
 * proof against a ₹29,999 fee, submitted with the note empty, and asserts the reason field
 * itself turns required-and-red rather than a lone red line floating above a box still
 * labelled "optional" — which is exactly how it read before.
 */
import { test, expect, type Page } from "@playwright/test";
import { Role } from "@prisma/client";
import { copyFileSync, readdirSync, rmSync } from "node:fs";
import { prisma, ensureUser, cleanupUser, type E2EUser } from "./helpers/db";

const u: E2EUser = { email: "e2e.over.sales@proitbridge.local", password: "Test#Over1", role: Role.SALESPERSON, twoFa: false };
let userId = "";
let leadId = "";
let proofPath = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/login\/otp|\/sales/, { timeout: 15_000 });
  if (new URL(page.url()).pathname === "/login/otp") {
    await page.getByLabel("6-digit code").fill(process.env.E2E_FIXED_OTP ?? "000000");
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

test.beforeAll(async () => {
  userId = await ensureUser(u);

  // Reuse a real stored proof image so the card renders like the salesperson sees it.
  const existing = readdirSync(".proof-storage/proofs").filter((f) => !f.endsWith(".ocr.json"))[0];
  const key = `proofs/over-collection-e2e-${process.pid}`;
  proofPath = `.proof-storage/${key}`;
  copyFileSync(`.proof-storage/proofs/${existing}`, proofPath);

  const pricing = await prisma.pricingMaster.findFirstOrThrow({ where: { program: "DATA_ANALYST" } });
  const lead = await prisma.lead.create({
    data: {
      fullName: "Over Payer", dob: new Date("1996-01-01"), doorNo: "1", street: "X", address: "1 X, Chennai",
      district: "Chennai", state: "Tamil Nadu", pincode: "600001", email: "overpay@example.com", mobile: "9700000188",
      interestedProgram: "DATA_ANALYST", interestedPlan: "PREMIUM",
      leadSource: "Self-intake link", salespersonId: userId, status: "BASIC_DETAILS_RECEIVED",
    },
  });
  leadId = lead.id;

  // Fee 29,999 — exactly the user's screenshot — against a 34,999 proof.
  await prisma.enrollment.create({
    data: {
      leadId, program: "DATA_ANALYST", plan: "PREMIUM", pricingId: pricing.id,
      standardFee: "29999.00", baseFee: "25423.73", gstAmount: "4575.27", gstPercent: "18.00",
      finalApprovedFee: "29999.00",
    },
  });
  await prisma.leadSelfProof.create({
    data: {
      leadId, storageKey: key, checksumSha256: "0".repeat(64),
      fileType: "image/jpeg", fileSize: 2048, originalFilename: "shared image.jpeg",
      ocrFields: { receivedAmount: "34999", paymentDate: "2026-08-11T00:00:00.000Z", transactionId: "312245825686", paymentMethod: "UPI" },
      ocrConfidence: {},
    },
  });
});

test.afterAll(async () => {
  if (leadId) {
    await prisma.leadSelfProof.deleteMany({ where: { leadId } });
    const e = await prisma.enrollment.findUnique({ where: { leadId }, select: { id: true } });
    if (e) {
      const pays = await prisma.payment.findMany({ where: { enrollmentId: e.id }, select: { id: true } });
      await prisma.paymentProof.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
      await prisma.payment.deleteMany({ where: { enrollmentId: e.id } });
      await prisma.enrollment.delete({ where: { id: e.id } });
    }
    await prisma.lead.delete({ where: { id: leadId } });
  }
  if (proofPath) rmSync(proofPath, { force: true });
  await cleanupUser(u.email);
  await prisma.$disconnect();
});

test("over-collection points at the reason field and turns it red", async ({ page }) => {
  await login(page);
  await page.goto(`/leads/${leadId}`);
  await page.waitForLoadState("networkidle");

  // Tick the four BR-20 confirmations, then submit with the note left empty.
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: /Confirm & record payment/i }).click();

  // The label must now read as required, and the message must sit under that field.
  const label = page.getByText("Reason — required *");
  await expect(label).toBeVisible();
  await expect(page.getByText(/more than the learner still owes/i)).toBeVisible();

  const panel = page.getByText(/Learner-submitted payment proof/i).locator("xpath=ancestor::div[1]/..");

  // The input itself must carry the invalid state, not just the words around it.
  const reason = panel.getByPlaceholder(/Why is more than the balance being taken/i);
  await expect(reason).toHaveAttribute("aria-invalid", "true");

  // And it must clear the moment they correct the amount. Inside the panel the text inputs
  // are, in order: amount, transaction id, note.
  await panel.getByRole("textbox").first().fill("29999");
  await expect(page.getByText("Reason — required *")).toHaveCount(0);
});

/**
 * 2FA is asked for once per WORKING DAY, not on every sign-in (business decision — CLAUDE.md).
 *
 * The security properties that MUST survive that relaxation are what this suite actually
 * guards: trust is bound to one browser and one user, it dies with a password change or a
 * deactivation, and it lapses when the window does. A cookie that skipped 2FA everywhere
 * would be a far worse bug than the friction it removed, so each of those is a test.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { Role, UserStatus } from "@prisma/client";
import { prisma, ensureUser, cleanupUser, type E2EUser } from "./helpers/db";

// FINANCE_REVIEWER is 2FA-mandatory by role, so every sign-in here hits the code step.
const FIN: E2EUser = { email: "e2e.2fa.fin@proitbridge.local", password: "Test#Fin2fa", role: Role.FINANCE_REVIEWER, twoFa: true };
const OTHER: E2EUser = { email: "e2e.2fa.other@proitbridge.local", password: "Test#Oth2fa", role: Role.DATA_MGMT_AUDITOR, twoFa: true };

const CODE = () => process.env.E2E_FIXED_OTP ?? "000000";

/** Sign in and report whether the verification-code step appeared. */
async function signIn(page: Page, u: E2EUser): Promise<{ askedForCode: boolean }> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/login\/otp|\/finance|\/audit/, { timeout: 15_000 });

  const askedForCode = new URL(page.url()).pathname === "/login/otp";
  if (askedForCode) {
    await page.getByLabel("6-digit code").fill(CODE());
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  }
  return { askedForCode };
}

/** Sign out via the app so the session dies but the remembered browser survives. */
async function signOut(page: Page) {
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
}

test.beforeAll(async () => {
  for (const u of [FIN, OTHER]) await ensureUser(u);
});
test.afterAll(async () => {
  // cleanupUser drops the remembered browsers along with the account.
  for (const u of [FIN, OTHER]) await cleanupUser(u.email);
  await prisma.$disconnect();
});

test("the code is asked for on the first sign-in, then not again on the same browser", async ({ context, page }) => {
  const first = await signIn(page, FIN);
  expect(first.askedForCode, "the very first sign-in must ask for a code").toBe(true);

  await signOut(page);

  // Same browser, same day → password only. This is the whole point of the change.
  const second = await signIn(page, FIN);
  expect(second.askedForCode, "a second sign-in the same day must NOT ask again").toBe(false);

  // Trust must end with TODAY in India — not 24 hours later, which would skip tomorrow
  // morning's challenge. 23:59:59.999 IST is 18:29:59.999 UTC.
  const user = await prisma.user.findUniqueOrThrow({ where: { email: FIN.email } });
  const device = await prisma.trustedDevice.findFirstOrThrow({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const IST = 330 * 60_000, DAY = 86_400_000;
  const endOfIstDay = Math.floor((Date.now() + IST) / DAY) * DAY - IST + DAY - 1;
  expect(device.expiresAt.getTime(), "trust must lapse at the end of the IST day").toBe(endOfIstDay);

  // The cookie must not be readable by scripts — it is a bearer token for skipping 2FA.
  const cookie = (await context.cookies()).find((c) => c.name === "pib_device");
  expect(cookie, "the trusted-device cookie should exist").toBeTruthy();
  expect(cookie!.httpOnly, "it must be HttpOnly").toBe(true);
});

test("a different browser still gets asked, even for the same user", async ({ page, browser }) => {
  await signIn(page, FIN); // establishes trust on THIS browser

  const fresh: BrowserContext = await browser.newContext();
  const freshPage = await fresh.newPage();
  const onFresh = await signIn(freshPage, FIN);
  expect(onFresh.askedForCode, "a machine that never passed 2FA must be challenged").toBe(true);
  await fresh.close();
});

test("one user's trust never covers another user on a shared browser", async ({ page }) => {
  const first = await signIn(page, FIN);
  expect(first.askedForCode).toBe(true);
  await signOut(page);

  // Same browser, carrying FIN's device cookie, but a different account.
  const other = await signIn(page, OTHER);
  expect(other.askedForCode, "a shared machine must still challenge a different account").toBe(true);
});

test("the trust lapses once the working day has passed", async ({ page }) => {
  await signIn(page, FIN);
  await signOut(page);
  expect((await signIn(page, FIN)).askedForCode).toBe(false);
  await signOut(page);

  // Age the token past its expiry rather than waiting for midnight IST.
  const user = await prisma.user.findUniqueOrThrow({ where: { email: FIN.email } });
  await prisma.trustedDevice.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  const after = await signIn(page, FIN);
  expect(after.askedForCode, "a lapsed working day must ask for the code again").toBe(true);
});

test("a deactivated user cannot ride a remembered browser back in", async ({ page }) => {
  await signIn(page, OTHER);
  await signOut(page);

  const user = await prisma.user.findUniqueOrThrow({ where: { email: OTHER.email } });
  await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.DEACTIVATED } });

  await page.goto("/login");
  await page.getByLabel("Email").fill(OTHER.email);
  await page.getByLabel("Password").fill(OTHER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForLoadState("networkidle");

  // Refused outright: a successful sign-in would have moved to /audit (or /login/otp), so
  // staying put on /login is the assertion. Status is checked before any device logic, which
  // is why a remembered browser buys a deactivated user nothing.
  expect(new URL(page.url()).pathname, "a deactivated user must not get in").toBe("/login");

  await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE } });
});

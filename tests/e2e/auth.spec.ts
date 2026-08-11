import { test, expect, type Page } from "@playwright/test";
import { prisma, ensureUser, cleanupUser, E2E } from "./helpers/db";

/**
 * Phase 2 — adversarial auth/RBAC tests. These attack the app rather than exercise the
 * happy path: cross-role 403, direct-action rejection, lockout, and session timeout.
 * The exhaustive per-cell permission proof is the unit test tests/unit/permissions.test.ts.
 */

const ids: Record<string, string> = {};

test.beforeAll(async () => {
  for (const u of Object.values(E2E)) {
    ids[u.email] = await ensureUser(u);
  }
});

test.afterAll(async () => {
  for (const u of Object.values(E2E)) await cleanupUser(u.email);
  await prisma.$disconnect();
});

async function fill(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Log in a user that has no 2FA and no forced password change → straight to dashboard. */
async function loginDirect(page: Page, u: { email: string; password: string }) {
  await fill(page, u.email, u.password);
}

test("unauthenticated access to a protected route redirects to /login", async ({ page }) => {
  const res = await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  expect(res).toBeTruthy();
});

test("a SALESPERSON is refused /finance and /admin with 403 (not a leaky redirect)", async ({ page }) => {
  await loginDirect(page, E2E.sales);
  await expect(page).toHaveURL(/\/sales/);

  const finance = await page.goto("/finance");
  expect(finance?.status()).toBe(403);

  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(403);
});

test("account locks after 5 failed logins and alerts the Super Admin (FR-AUTH-07)", async ({ page }) => {
  // Reset counters for a deterministic run.
  await prisma.user.update({ where: { email: E2E.lock.email }, data: { failedLoginCount: 0, lockedUntil: null } });

  for (let i = 0; i < 5; i++) {
    await fill(page, E2E.lock.email, "WrongPassword#1");
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  }
  // 6th attempt is refused with the lock message even though the password is now correct.
  await fill(page, E2E.lock.email, E2E.lock.password);
  await expect(page.getByText(/temporarily locked/i)).toBeVisible();

  const locked = await prisma.securityEvent.count({
    where: { eventType: "ACCOUNT_LOCKED", userId: ids[E2E.lock.email] },
  });
  expect(locked).toBeGreaterThanOrEqual(1);

  const alerts = await prisma.notification.count({ where: { type: "SECURITY_ALERT" } });
  expect(alerts).toBeGreaterThanOrEqual(1);
});

test("an idle session past the timeout is rejected on the next request", async ({ page }) => {
  await loginDirect(page, E2E.sales);
  await expect(page).toHaveURL(/\/sales/);

  // Push activity back 40 minutes (> the 30-minute non-admin timeout).
  await prisma.session.updateMany({
    where: { userId: ids[E2E.sales.email], revokedAt: null },
    data: { lastActiveAt: new Date(Date.now() - 40 * 60_000) },
  });

  await page.goto("/sales");
  await expect(page).toHaveURL(/\/login/);
});

test("SUPER_ADMIN session dies at 15 min while a non-admin lives to 30 (NFR-07a)", async ({ page, browser }) => {
  // Non-admin salesperson, idle 20 minutes → still valid (< 30).
  await loginDirect(page, E2E.sales);
  await expect(page).toHaveURL(/\/sales/);
  await prisma.session.updateMany({
    where: { userId: ids[E2E.sales.email], revokedAt: null },
    data: { lastActiveAt: new Date(Date.now() - 20 * 60_000) },
  });
  await page.goto("/sales");
  await expect(page).toHaveURL(/\/sales/);

  // Break-glass Super Admin login (2FA via the fixed dev OTP), idle 20 minutes → expired (> 15).
  const adminPage = await (await browser.newContext()).newPage();
  await fill(adminPage, E2E.bgadmin.email, E2E.bgadmin.password);
  await expect(adminPage).toHaveURL(/\/login\/otp/);
  await adminPage.getByLabel("6-digit code").fill(process.env.E2E_FIXED_OTP ?? "000000");
  await adminPage.getByRole("button", { name: "Verify" }).click();
  await expect(adminPage).toHaveURL(/\/admin/);

  await prisma.session.updateMany({
    where: { userId: ids[E2E.bgadmin.email], revokedAt: null },
    data: { lastActiveAt: new Date(Date.now() - 20 * 60_000) },
  });
  await adminPage.goto("/admin");
  await expect(adminPage).toHaveURL(/\/login/);
});

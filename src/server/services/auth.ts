/**
 * Authentication service (FR-AUTH-01..11, FR-SEC-04..08). All auth business logic lives
 * here; server actions are thin wrappers. Every login, logout and failed login is
 * recorded to SecurityEvent with user + IP + timestamp (FR-AUTH-09). Responses are
 * deliberately generic to avoid account enumeration.
 */
import "server-only";
import { createHash, randomInt } from "node:crypto";
import { Role, UserStatus } from "@prisma/client";
import { db } from "@/server/db";
import { SECURITY } from "@/lib/constants";
import { ROLE_HOME } from "@/server/auth/permissions";
import { hashPassword, verifyPassword, isPasswordStrong } from "@/server/auth/password";
import {
  createSession,
  getCurrentSessionRecord,
  markTwoFaVerified,
  setSessionOtp,
  revokeAllUserSessions,
  revokeCurrentSession,
} from "@/server/auth/session";
import { notifyUser, sendEmail } from "@/server/notifications";

const TWO_FA_MANDATORY_ROLES = new Set<Role>([
  Role.SUPER_ADMIN,
  Role.DATA_MGMT_AUDITOR,
  Role.FINANCE_REVIEWER,
]);

const GENERIC_LOGIN_ERROR = "Invalid email or password.";

export interface AuthContextInput {
  ip?: string | null;
  userAgent?: string | null;
}

export type LoginResult =
  | { ok: true; step: "otp" | "change-password" | "dashboard"; home: string }
  | { ok: false; error: string };

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function logSecurity(
  eventType: string,
  userId: string | null,
  ip?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await db.securityEvent.create({
    data: { eventType, userId, ipAddress: ip ?? null, details: details ?? undefined },
  });
}

async function findFinanceReviewer() {
  return db.user.findFirst({
    where: { role: Role.FINANCE_REVIEWER, status: UserStatus.ACTIVE },
  });
}

async function findPrimarySuperAdmin() {
  return db.user.findFirst({
    where: { role: Role.SUPER_ADMIN, status: UserStatus.ACTIVE, isBreakGlass: false },
  });
}

/** Generate, store (hashed) and email a 6-digit OTP for a session (FR-AUTH-10). */
async function issueOtp(sessionId: string, email: string): Promise<void> {
  // Test hook: a deterministic OTP for e2e, allowed ONLY outside production and only
  // when explicitly enabled. Never active in a real deployment.
  const fixed =
    process.env.NODE_ENV !== "production" && process.env.E2E_FIXED_OTP
      ? process.env.E2E_FIXED_OTP
      : null;
  const code =
    fixed ?? String(randomInt(0, 10 ** SECURITY.OTP_LENGTH)).padStart(SECURITY.OTP_LENGTH, "0");
  const expiresAt = new Date(Date.now() + SECURITY.OTP_TTL_MINUTES * 60_000);
  await setSessionOtp(sessionId, sha256(code), expiresAt);
  await sendEmail({
    to: email,
    subject: "Your ProITbridge verification code",
    body: `Your one-time verification code is ${code}. It expires in ${SECURITY.OTP_TTL_MINUTES} minutes. If you did not attempt to sign in, contact your Super Admin.`,
  });
}

export async function login(
  email: string,
  password: string,
  ctx: AuthContextInput = {},
): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } });

  // Equalise timing whether or not the account exists (anti-enumeration).
  if (!user) {
    await verifyPassword(password, "$2a$12$0000000000000000000000000000000000000000000000000000");
    await logSecurity("LOGIN_FAILED", null, ctx.ip, { reason: "unknown_email" });
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  if (user.status !== UserStatus.ACTIVE) {
    await logSecurity("LOGIN_FAILED", user.id, ctx.ip, { reason: "deactivated" });
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await logSecurity("LOGIN_FAILED", user.id, ctx.ip, { reason: "locked" });
    return {
      ok: false,
      error: "Your account is temporarily locked. Please try again later or reset your password.",
    };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    const failed = user.failedLoginCount + 1;
    const locking = failed >= SECURITY.MAX_FAILED_LOGINS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: locking ? new Date(Date.now() + SECURITY.LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await logSecurity("LOGIN_FAILED", user.id, ctx.ip, { reason: "bad_password", failed });
    if (locking) {
      await logSecurity("ACCOUNT_LOCKED", user.id, ctx.ip, { failed });
      const admin = await findPrimarySuperAdmin();
      if (admin) {
        await notifyUser({
          recipientId: admin.id,
          recipientEmail: admin.email,
          type: "SECURITY_ALERT",
          subject: "Account locked after failed logins",
          body: `The account ${user.email} was locked after ${failed} consecutive failed login attempts.`,
          relatedEntityType: "User",
          relatedEntityId: user.id,
        });
      }
    }
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  // Success: clear failure counters, stamp last login.
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLogin: new Date() },
  });
  await logSecurity("LOGIN_SUCCESS", user.id, ctx.ip);

  const twoFaRequired = TWO_FA_MANDATORY_ROLES.has(user.role) || user.twoFaEnabled;
  const { sessionId } = await createSession({
    userId: user.id,
    role: user.role,
    twoFaRequired,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  // Super Admin login → notify Rajesh (NFR-07a). Break-glass → alert primary SA + Rajesh.
  if (user.role === Role.SUPER_ADMIN) {
    const rajesh = await findFinanceReviewer();
    if (rajesh) {
      await notifyUser({
        recipientId: rajesh.id,
        recipientEmail: rajesh.email,
        type: "SUPER_ADMIN_LOGIN",
        subject: "Super Admin signed in",
        body: `A Super Admin (${user.email}) signed in at ${new Date().toISOString()}.`,
      });
    }
    if (user.isBreakGlass) {
      const primary = await findPrimarySuperAdmin();
      const targets = [primary, rajesh].filter((u): u is NonNullable<typeof u> => Boolean(u));
      for (const t of targets) {
        await notifyUser({
          recipientId: t.id,
          recipientEmail: t.email,
          type: "BREAK_GLASS_LOGIN",
          subject: "BREAK-GLASS account used",
          body: `The break-glass Super Admin account (${user.email}) was used to sign in. Verify this was expected.`,
        });
      }
      await logSecurity("BREAK_GLASS_LOGIN", user.id, ctx.ip);
    }
  }

  if (twoFaRequired) {
    await issueOtp(sessionId, user.email);
    return { ok: true, step: "otp", home: ROLE_HOME[user.role] };
  }
  if (user.mustChangePassword) {
    return { ok: true, step: "change-password", home: ROLE_HOME[user.role] };
  }
  return { ok: true, step: "dashboard", home: ROLE_HOME[user.role] };
}

export type OtpResult =
  | { ok: true; step: "change-password" | "dashboard"; home: string }
  | { ok: false; error: string };

export async function verifyOtp(code: string, ctx: AuthContextInput = {}): Promise<OtpResult> {
  const record = await getCurrentSessionRecord();
  if (!record || record.revokedAt) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (record.twoFaVerified) {
    return { ok: true, step: record.user.mustChangePassword ? "change-password" : "dashboard", home: ROLE_HOME[record.user.role] };
  }
  if (!record.otpHash || !record.otpExpiresAt || record.otpExpiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Your verification code has expired. Please sign in again." };
  }
  if (record.otpAttempts >= SECURITY.OTP_MAX_ATTEMPTS) {
    await revokeCurrentSession();
    await logSecurity("LOGIN_2FA_LOCKED", record.userId, ctx.ip);
    return { ok: false, error: "Too many incorrect codes. Please sign in again." };
  }
  if (sha256(code.trim()) !== record.otpHash) {
    await db.session.update({ where: { id: record.id }, data: { otpAttempts: { increment: 1 } } });
    await logSecurity("LOGIN_2FA_FAILED", record.userId, ctx.ip);
    return { ok: false, error: "That code is incorrect. Please try again." };
  }

  await markTwoFaVerified(record.id);
  await logSecurity("LOGIN_2FA_OK", record.userId, ctx.ip);
  return {
    ok: true,
    step: record.user.mustChangePassword ? "change-password" : "dashboard",
    home: ROLE_HOME[record.user.role],
  };
}

export async function logout(userId: string, ctx: AuthContextInput = {}): Promise<void> {
  await revokeCurrentSession();
  await logSecurity("LOGOUT", userId, ctx.ip);
}

/**
 * Change the current user's password (first-login forced change or voluntary). Enforces
 * the policy, then invalidates ALL of the user's sessions (FR-SEC-08) and issues a fresh
 * one for this device so the flow continues seamlessly.
 */
export type ChangePasswordResult = { ok: true; home: string } | { ok: false; error: string };

export async function changePassword(
  userId: string,
  newPassword: string,
  ctx: AuthContextInput & { currentPassword?: string } = {},
): Promise<ChangePasswordResult> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== UserStatus.ACTIVE) {
    return { ok: false, error: "Unable to change password." };
  }
  // Voluntary change requires the current password; forced first-login change does not.
  if (!user.mustChangePassword) {
    if (!ctx.currentPassword || !(await verifyPassword(ctx.currentPassword, user.passwordHash))) {
      return { ok: false, error: "Your current password is incorrect." };
    }
  }
  if (!isPasswordStrong(newPassword)) {
    return { ok: false, error: "Password does not meet the required policy." };
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    return { ok: false, error: "Choose a password you have not used before." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  await revokeAllUserSessions(user.id);
  await logSecurity("PASSWORD_CHANGED", user.id, ctx.ip);

  const twoFaRequired = TWO_FA_MANDATORY_ROLES.has(user.role) || user.twoFaEnabled;
  // Re-issue a session already marked 2FA-verified (they cleared 2FA this login).
  await createSession({ userId: user.id, role: user.role, twoFaRequired: false, ip: ctx.ip, userAgent: ctx.userAgent });
  void twoFaRequired;
  return { ok: true, home: ROLE_HOME[user.role] };
}

/** Always returns the same result to avoid account enumeration (FR-AUTH-05). */
export async function requestPasswordReset(email: string, ctx: AuthContextInput = {}): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } });
  if (user && user.status === UserStatus.ACTIVE) {
    // Invalidate previous unused tokens.
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const raw = createHash("sha256").update(`${user.id}:${Date.now()}:${randomInt(1e9)}`).digest("hex");
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + SECURITY.RESET_TTL_MINUTES * 60_000),
      },
    });
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${raw}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your ProITbridge password",
      body: `Use this single-use link within ${SECURITY.RESET_TTL_MINUTES} minutes to reset your password:\n${url}\nIf you did not request this, you can ignore this email.`,
    });
    await logSecurity("PASSWORD_RESET_REQUESTED", user.id, ctx.ip);
  }
}

export type ResetResult = { ok: true } | { ok: false; error: string };

export async function resetPassword(
  token: string,
  newPassword: string,
  ctx: AuthContextInput = {},
): Promise<ResetResult> {
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This reset link is invalid or has expired." };
  }
  if (!isPasswordStrong(newPassword)) {
    return { ok: false, error: "Password does not meet the required policy." };
  }
  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
  });
  await revokeAllUserSessions(record.userId);
  await logSecurity("PASSWORD_RESET_COMPLETED", record.userId, ctx.ip);
  return { ok: true };
}

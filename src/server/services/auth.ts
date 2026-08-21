/**
 * Authentication service (FR-AUTH-01..11, FR-SEC-04..08). All auth business logic lives
 * here; server actions are thin wrappers. Every login, logout and failed login is
 * recorded to SecurityEvent with user + IP + timestamp (FR-AUTH-09). Responses are
 * deliberately generic to avoid account enumeration.
 */
import "server-only";
import { createHash } from "node:crypto";
import { Role, UserStatus } from "@prisma/client";
import { db } from "@/server/db";
import { SECURITY } from "@/lib/constants";
import { ROLE_HOME } from "@/server/auth/permissions";
import { hashPassword, verifyPassword, isPasswordStrong } from "@/server/auth/password";
import {
  createSession,
  getCurrentSessionRecord,
  markTwoFaVerified,
  revokeAllUserSessions,
  revokeCurrentSession,
} from "@/server/auth/session";
import { issueTrustedDevice } from "@/server/auth/trusted-device";
import { notifyUser } from "@/server/notifications";
import { getConfigValue } from "@/server/services/system-config";

/**
 * Roles that must clear an emailed verification code, read from SystemConfig
 * (`two_fa_required_roles`) so the Super Admin can turn it on or off without a code change
 * (NFR-16, BR-13). Set to `[]` by business decision — everyone signs in with a password
 * alone. Put the role names back in the array to reinstate it.
 *
 * A MISSING or malformed setting falls back to the three money-facing roles: an unreadable
 * config must fail toward asking for the code, never toward skipping it.
 */
const TWO_FA_DEFAULT_ROLES: Role[] = [Role.SUPER_ADMIN, Role.DATA_MGMT_AUDITOR, Role.FINANCE_REVIEWER];

async function twoFaRequiredRoles(): Promise<Set<Role>> {
  const raw = await getConfigValue("two_fa_required_roles");
  if (!Array.isArray(raw)) return new Set(TWO_FA_DEFAULT_ROLES);
  const valid = Object.values(Role) as string[];
  return new Set(raw.filter((r): r is Role => typeof r === "string" && valid.includes(r)));
}

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

  // Two-factor is NEVER required, and this is deliberate rather than a config default.
  //
  // The 6-digit code was delivered by email, and email was removed from this application
  // by business decision. Honouring `two_fa_required_roles` or a user's `twoFaEnabled`
  // flag would therefore demand a code that can no longer reach anybody — locking that
  // person out permanently, with no password-reset flow left to rescue them either.
  //
  // So the session is opened already-verified. The config keys and the OTP verification
  // path are left in place but are unreachable; restoring two-factor means restoring a
  // delivery channel first.
  await createSession({
    userId: user.id,
    role: user.role,
    twoFaRequired: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  // Super Admin login → notify Rajesh (NFR-07a). Break-glass → alert primary SA + Rajesh.
  if (user.role === Role.SUPER_ADMIN) {
    const rajesh = await findFinanceReviewer();
    if (rajesh) {
      await notifyUser({
        recipientId: rajesh.id,
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
          type: "BREAK_GLASS_LOGIN",
          subject: "BREAK-GLASS account used",
          body: `The break-glass Super Admin account (${user.email}) was used to sign in. Verify this was expected.`,
        });
      }
      await logSecurity("BREAK_GLASS_LOGIN", user.id, ctx.ip);
    }
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
  // Remember this browser so the next sign-in inside the window needs only the password.
  await issueTrustedDevice(record.userId, { ip: ctx.ip, userAgent: ctx.userAgent });
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

  const twoFaRequired = (await twoFaRequiredRoles()).has(user.role) || user.twoFaEnabled;
  // Re-issue a session already marked 2FA-verified (they cleared 2FA this login).
  await createSession({ userId: user.id, role: user.role, twoFaRequired: false, ip: ctx.ip, userAgent: ctx.userAgent });
  void twoFaRequired;
  return { ok: true, home: ROLE_HOME[user.role] };
}

/**
 * Server-side session store (FR-SEC-06/08). The cookie is only a signed reference; this
 * module is the authority. It enforces idle timeout (role-specific — 15 min for
 * SUPER_ADMIN, 30 otherwise, read from SystemConfig), absolute expiry, revocation and
 * live user status/role. Logout, password change, role change and deactivation all
 * invalidate sessions here, immediately.
 *
 * Node-only (uses node:crypto, Prisma, next/headers). Middleware uses cookie.ts instead.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { Role, UserStatus } from "@prisma/client";
import { db } from "@/server/db";
import { SECURITY } from "@/lib/constants";
import { getSessionTimeoutMinutes } from "@/server/services/system-config";
import {
  SESSION_COOKIE,
  signSessionCookie,
  verifySessionCookie,
} from "@/server/auth/cookie";
import type { Actor } from "@/server/auth/permissions";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface SessionContext {
  actor: Actor;
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    status: UserStatus;
    mustChangePassword: boolean;
    isBreakGlass: boolean;
  };
  session: { id: string; twoFaVerified: boolean };
}

/**
 * Create a session for a user after successful password verification. Sets the signed
 * cookie. `twoFaVerified` starts false when 2FA is required; the OTP step flips it.
 */
export async function createSession(args: {
  userId: string;
  role: Role;
  twoFaRequired: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ sessionId: string }> {
  const raw = randomBytes(32).toString("hex");
  const absoluteExpiresAt = new Date(Date.now() + SECURITY.SESSION_ABSOLUTE_HOURS * 3600_000);
  const session = await db.session.create({
    data: {
      userId: args.userId,
      tokenHash: hashToken(raw),
      twoFaVerified: !args.twoFaRequired,
      absoluteExpiresAt,
      ipAddress: args.ip ?? null,
      userAgent: args.userAgent ?? null,
    },
  });

  const cookie = await signSessionCookie({ sid: raw, role: args.role });
  const store = await cookies();
  store.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SECURITY.SESSION_ABSOLUTE_HOURS * 3600,
  });
  return { sessionId: session.id };
}

/**
 * Resolve the current session from the cookie, enforcing all server-side rules.
 * Returns null if there is no valid session. Slides the idle window on success.
 */
export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const payload = await verifySessionCookie(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(payload.sid) },
    include: { user: true },
  });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  if (now > session.absoluteExpiresAt.getTime()) {
    await revokeSessionById(session.id);
    return null;
  }

  // Deactivated users lose access immediately (FR-SEC-08).
  if (session.user.status !== UserStatus.ACTIVE) {
    await revokeSessionById(session.id);
    return null;
  }

  // Idle timeout, role-specific (FR-AUTH-06, NFR-07a).
  const timeoutMs = (await getSessionTimeoutMinutes(session.user.role)) * 60_000;
  if (now - session.lastActiveAt.getTime() > timeoutMs) {
    await revokeSessionById(session.id);
    return null;
  }

  // Slide the window.
  await db.session.update({ where: { id: session.id }, data: { lastActiveAt: new Date(now) } });

  return {
    actor: { userId: session.user.id, role: session.user.role },
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      status: session.user.status,
      mustChangePassword: session.user.mustChangePassword,
      isBreakGlass: session.user.isBreakGlass,
    },
    session: { id: session.id, twoFaVerified: session.twoFaVerified },
  };
}

/** Raw session row (incl. OTP fields) for the current cookie — used by the 2FA step. */
export async function getCurrentSessionRecord() {
  const store = await cookies();
  const payload = await verifySessionCookie(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return db.session.findUnique({
    where: { tokenHash: hashToken(payload.sid) },
    include: { user: true },
  });
}

export async function markTwoFaVerified(sessionId: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { twoFaVerified: true, otpHash: null, otpExpiresAt: null, otpAttempts: 0 },
  });
}

export async function setSessionOtp(sessionId: string, otpHash: string, expiresAt: Date): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { otpHash, otpExpiresAt: expiresAt, otpAttempts: 0 },
  });
}

export { hashToken };

async function revokeSessionById(sessionId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

/** Revoke the current session and clear the cookie (logout). */
export async function revokeCurrentSession(): Promise<void> {
  const store = await cookies();
  const payload = await verifySessionCookie(store.get(SESSION_COOKIE)?.value);
  if (payload) {
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(payload.sid) } });
    if (session && !session.revokedAt) await revokeSessionById(session.id);
  }
  store.delete(SESSION_COOKIE);
}

/** Revoke ALL of a user's sessions (password change, role change, deactivation). */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

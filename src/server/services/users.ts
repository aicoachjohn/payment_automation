/**
 * User management (FR-AUTH-08/11, BR-21, BR-23). Super-Admin-only. Users are never
 * hard-deleted — only deactivated. Exactly one ACTIVE non-break-glass Super Admin may
 * exist. Role change and deactivation revoke the target's sessions immediately
 * (FR-SEC-08). Every action writes an audit entry within the same transaction.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { Role, UserStatus } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { revokeAllUserSessions } from "@/server/auth/session";
import { notifyUser } from "@/server/notifications";
import type { Actor } from "@/server/auth/permissions";

/** A safe, user-facing error surfaced by the action layer. */
export class UserServiceError extends Error {
  readonly code = "USER_SERVICE_ERROR";
}

/** Generate a policy-compliant temporary password (emailed; user must change it). */
function tempPassword(): string {
  return `Aa1!${randomBytes(9).toString("base64url")}`;
}

async function assertSingleSuperAdmin(role: Role, isBreakGlass: boolean, excludeUserId?: string) {
  if (role !== Role.SUPER_ADMIN || isBreakGlass) return;
  const existing = await db.user.findFirst({
    where: {
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      isBreakGlass: false,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  });
  if (existing) {
    throw new UserServiceError(
      "There is already an active Super Admin. A second Super Admin may exist only as a break-glass account.",
    );
  }
}

export async function createUser(
  actor: Actor,
  input: { name: string; email: string; mobile: string; role: Role; isBreakGlass?: boolean },
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const isBreakGlass = input.role === Role.SUPER_ADMIN ? Boolean(input.isBreakGlass) : false;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new UserServiceError("A user with that email already exists.");
  await assertSingleSuperAdmin(input.role, isBreakGlass);

  const plain = tempPassword();
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name.trim(),
        email,
        mobile: input.mobile.trim(),
        role: input.role,
        passwordHash: await hashPassword(plain),
        mustChangePassword: true,
        isBreakGlass,
        twoFaEnabled:
          input.role === Role.SUPER_ADMIN ||
          input.role === Role.DATA_MGMT_AUDITOR ||
          input.role === Role.FINANCE_REVIEWER,
        createdBy: actor.userId,
      },
    });
    await writeAudit(tx, {
      entityType: "User",
      entityId: created.id,
      action: "CREATE",
      changes: [
        { field: "email", oldValue: null, newValue: email },
        { field: "role", oldValue: null, newValue: input.role },
        { field: "isBreakGlass", oldValue: null, newValue: isBreakGlass },
      ],
      actor,
    });
    return created;
  });

  await notifyUser({
    recipientId: user.id,
    type: "ACCOUNT_CREATED",
    subject: "Your ProITbridge account",
    body: `An account has been created for you (role: ${input.role}). Temporary password: ${plain}\nYou will be required to change it at first sign-in.`,
  });
  return { id: user.id };
}

export async function updateUserRole(
  actor: Actor,
  input: { userId: string; role: Role },
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new UserServiceError("User not found.");
  if (user.role === input.role) return;
  await assertSingleSuperAdmin(input.role, user.isBreakGlass, user.id);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role: input.role } });
    await writeAudit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "UPDATE_ROLE",
      changes: [{ field: "role", oldValue: user.role, newValue: input.role }],
      actor,
    });
  });
  // Role change invalidates all sessions (FR-SEC-08).
  await revokeAllUserSessions(user.id);
}

export async function updateUserProfile(
  actor: Actor,
  input: { userId: string; name: string; mobile: string },
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new UserServiceError("User not found.");
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { name: input.name.trim(), mobile: input.mobile.trim() },
    });
    await writeAudit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "UPDATE_PROFILE",
      changes: [
        { field: "name", oldValue: user.name, newValue: input.name.trim() },
        { field: "mobile", oldValue: user.mobile, newValue: input.mobile.trim() },
      ],
      actor,
    });
  });
}

export async function setUserStatus(
  actor: Actor,
  input: { userId: string; status: UserStatus },
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new UserServiceError("User not found.");
  if (user.status === input.status) return;

  if (input.status === UserStatus.DEACTIVATED) {
    if (user.role === Role.SUPER_ADMIN && !user.isBreakGlass) {
      const others = await db.user.count({
        where: { role: Role.SUPER_ADMIN, status: UserStatus.ACTIVE, isBreakGlass: false, id: { not: user.id } },
      });
      if (others === 0) {
        throw new UserServiceError("You cannot deactivate the only active Super Admin.");
      }
    }
  } else {
    // Reactivating to an active state — re-check the single-Super-Admin rule.
    await assertSingleSuperAdmin(user.role, user.isBreakGlass, user.id);
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: input.status } });
    await writeAudit(tx, {
      entityType: "User",
      entityId: user.id,
      action: input.status === UserStatus.DEACTIVATED ? "DEACTIVATE" : "REACTIVATE",
      changes: [{ field: "status", oldValue: user.status, newValue: input.status }],
      actor,
    });
  });
  if (input.status === UserStatus.DEACTIVATED) {
    await revokeAllUserSessions(user.id); // FR-SEC-08
  }
}

export async function listUsers() {
  return db.user.findMany({
    orderBy: [{ status: "asc" }, { role: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, mobile: true, role: true, status: true,
      isBreakGlass: true, twoFaEnabled: true, mustChangePassword: true, lastLogin: true, createdAt: true,
    },
  });
}

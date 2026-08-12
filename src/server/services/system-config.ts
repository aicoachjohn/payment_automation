/**
 * SystemConfig accessor (BR-13, NFR-16). Business parameters are configuration-driven
 * and read from the database, never hard-coded. Static security constants that are not
 * meant to be tuned per-deployment live in src/lib/constants.
 */
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { SECURITY } from "@/lib/constants";

/** Read a config value as a number, falling back if missing or malformed. */
export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  const value = row?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Read the raw JSON config value (or null). For the settings console. */
export async function getConfigValue(key: string): Promise<unknown> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** All config rows, for the Super Admin settings console. */
export async function listConfig(actor: Actor): Promise<{ key: string; value: unknown; description: string | null; updatedAt: string }[]> {
  requirePermission(actor, "config:write");
  const rows = await db.systemConfig.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({ key: r.key, value: r.value, description: r.description, updatedAt: r.updatedAt.toISOString() }));
}

/**
 * Set a system-config value (FR-ADM-05..09, NFR-16, BR-13). Super Admin only. Records
 * previous and new value to the immutable audit trail. Configuration, not code — no
 * business parameter is ever hard-coded.
 */
export async function setConfig(actor: Actor, key: string, value: unknown, description?: string): Promise<void> {
  requirePermission(actor, "config:write");
  if (!key.trim()) throw new Error("A configuration key is required.");
  const existing = await db.systemConfig.findUnique({ where: { key } });
  await db.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key },
      create: { key, value: value as never, description: description ?? null, updatedBy: actor.userId },
      update: { value: value as never, description: description ?? existing?.description ?? null, updatedBy: actor.userId },
    });
    await writeAudit(tx, {
      entityType: "SystemConfig",
      entityId: key,
      action: existing ? "CONFIG_UPDATE" : "CONFIG_CREATE",
      changes: [{ field: "value", oldValue: existing ? JSON.stringify(existing.value) : null, newValue: JSON.stringify(value) }],
      actor,
    });
  });
}

/** Inactivity session timeout in minutes for a role (SUPER_ADMIN gets the tighter one). */
export async function getSessionTimeoutMinutes(role: Role): Promise<number> {
  if (role === Role.SUPER_ADMIN) {
    return getConfigNumber(
      "superadmin_session_timeout_minutes",
      SECURITY.SUPERADMIN_SESSION_TIMEOUT_MINUTES,
    );
  }
  return getConfigNumber("session_timeout_minutes", SECURITY.DEFAULT_SESSION_TIMEOUT_MINUTES);
}

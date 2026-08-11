/**
 * SystemConfig accessor (BR-13, NFR-16). Business parameters are configuration-driven
 * and read from the database, never hard-coded. Static security constants that are not
 * meant to be tuned per-deployment live in src/lib/constants.
 */
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { SECURITY } from "@/lib/constants";

/** Read a config value as a number, falling back if missing or malformed. */
export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  const value = row?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

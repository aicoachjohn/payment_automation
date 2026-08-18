/**
 * "Ask for the code once a day, not every sign-in" (FR-AUTH-10, relaxed by business
 * decision — see CLAUDE.md).
 *
 * After a user clears 2FA, their browser is handed an opaque random token in an HttpOnly
 * cookie and a matching row is written here. While that row is live, signing in on THAT
 * browser needs only the password. Trust lapses at the END OF THE IST WORKING DAY, so the
 * first sign-in each morning always asks for a code — a rolling 24-hour window would instead
 * carry overnight and skip that morning. Config-driven via `two_fa_trust_scope`
 * (`working_day` | `off`) so the Super Admin can switch it off without a code change
 * (BR-13, NFR-16).
 *
 * The security properties that are deliberately preserved:
 *   · Only the SHA-256 hash is stored, so a leaked database row cannot be replayed.
 *   · The DB row — not the cookie — is authoritative, so trust can be revoked centrally.
 *   · Trust is bound to one browser AND one user; a new machine still gets a code.
 *   · Password change, role change, deactivation and reset all revoke it, because they all
 *     funnel through revokeAllUserSessions.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { TRUSTED_DEVICE_COOKIE } from "@/lib/constants";
import { getConfigString } from "@/server/services/system-config";
import { istEndOfDay } from "@/lib/ist";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * How far one 2FA pass carries. `working_day` (the default) means it lapses at 23:59:59.999
 * IST the same day, so the first sign-in each morning always asks for a code — a fixed
 * 24-hour window would instead roll overnight and skip that morning. `off` demands a code
 * every time. Anything unrecognised is treated as `off`: an unreadable setting must fail
 * toward asking, never toward trusting.
 */
export async function trustedDeviceScope(): Promise<"working_day" | "off"> {
  const scope = await getConfigString("two_fa_trust_scope", "working_day");
  return scope === "working_day" ? "working_day" : "off";
}

/** When trust granted `now` should lapse, or null if the feature is switched off. */
export async function trustedDeviceExpiry(now: Date = new Date()): Promise<Date | null> {
  return (await trustedDeviceScope()) === "working_day" ? istEndOfDay(now) : null;
}

/**
 * Has THIS browser already cleared 2FA for THIS user, inside the window? Consumes nothing —
 * the token stays valid until it expires or is revoked — but does slide `lastUsedAt` so the
 * Super Admin can see which devices are actually in use.
 */
export async function hasTrustedDevice(userId: string): Promise<boolean> {
  if ((await trustedDeviceScope()) === "off") return false;

  const raw = (await cookies()).get(TRUSTED_DEVICE_COOKIE)?.value;
  if (!raw) return false;

  const device = await db.trustedDevice.findUnique({ where: { tokenHash: hashToken(raw) } });
  // The userId check is what stops a cookie from one account waving another one through on
  // a shared machine.
  if (!device || device.userId !== userId) return false;
  if (device.revokedAt || device.expiresAt.getTime() <= Date.now()) return false;

  await db.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return true;
}

/**
 * Remember this browser after a successful code entry. Any previous token for the same user
 * on this browser is replaced, so the window runs from the most recent verification.
 */
export async function issueTrustedDevice(
  userId: string,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const expiresAt = await trustedDeviceExpiry();
  if (!expiresAt) return;

  const store = await cookies();
  const previous = store.get(TRUSTED_DEVICE_COOKIE)?.value;
  if (previous) {
    await db.trustedDevice.updateMany({
      where: { tokenHash: hashToken(previous), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  const raw = randomBytes(32).toString("hex");
  await db.trustedDevice.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  });

  // The cookie is told to die at the same instant as the row, so a browser closed overnight
  // does not hold a token the server would refuse anyway.
  store.set(TRUSTED_DEVICE_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Drop every remembered browser for a user — called wherever sessions are revoked (password
 * change, role change, deactivation, reset). Without this, someone removed from the system
 * would still skip 2FA on a machine they had already used.
 */
export async function revokeTrustedDevices(userId: string): Promise<number> {
  const res = await db.trustedDevice.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

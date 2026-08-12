/**
 * Finance digest scheduling (FR-FIN-26). Rajesh can schedule a daily and/or a monthly
 * summary email to HIMSELF. We queue it through the notification service as PENDING
 * rows with a `scheduledAt`; Phase 10's job runner delivers and reschedules them. This
 * writes only to `notification` (a self-addressed reminder) — never to payment data.
 */
import "server-only";
import { db } from "@/server/db";
import { requirePermission, type Actor } from "@/server/auth/permissions";

const DAILY = "FINANCE_DAILY_DIGEST";
const MONTHLY = "FINANCE_MONTHLY_DIGEST";

function nextDaily(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 6, 0, 0, 0));
  return d;
}
function nextMonthly(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 6, 0, 0, 0));
}

/** Enable/disable the daily and monthly finance digests for the current user. */
export async function scheduleFinanceDigest(
  actor: Actor,
  input: { daily: boolean; monthly: boolean },
  now: Date = new Date(),
): Promise<void> {
  requirePermission(actor, "finance:read");
  await Promise.all([
    setDigest(actor.userId, DAILY, input.daily, nextDaily(now), "Daily approved-collection summary"),
    setDigest(actor.userId, MONTHLY, input.monthly, nextMonthly(now), "Monthly collection summary"),
  ]);
}

async function setDigest(userId: string, type: string, on: boolean, scheduledAt: Date, subject: string): Promise<void> {
  // Cancel any existing pending copy first (idempotent toggle).
  await db.notification.updateMany({
    where: { recipientId: userId, type, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (!on) return;
  await db.notification.create({
    data: {
      recipientId: userId,
      type,
      channel: "EMAIL",
      subject,
      body: "Your scheduled Finance summary will be delivered here (activated in Phase 10).",
      status: "PENDING",
      scheduledAt,
    },
  });
}

/** Current digest preferences for the user (for pre-checking the form). */
export async function getFinanceDigestPrefs(actor: Actor): Promise<{ daily: boolean; monthly: boolean }> {
  requirePermission(actor, "finance:read");
  const pending = await db.notification.findMany({
    where: { recipientId: actor.userId, type: { in: [DAILY, MONTHLY] }, status: "PENDING" },
    select: { type: true },
  });
  const types = new Set(pending.map((p) => p.type));
  return { daily: types.has(DAILY), monthly: types.has(MONTHLY) };
}

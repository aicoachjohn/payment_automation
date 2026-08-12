/**
 * Daily automation tick endpoint (Phase 10). Runs the idempotent automation service, so a
 * scheduler (cron / platform scheduler) can POST here once a day. Two auth paths:
 *   - a Super Admin session, or
 *   - a shared secret in `x-cron-secret` matching CRON_SECRET (for headless schedulers).
 * Idempotent: re-posting for the same IST day sends nothing twice.
 */
import { getSession } from "@/server/auth/session";
import { Role } from "@prisma/client";
import { runDailyAutomation } from "@/server/services/automation";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  let authorised = Boolean(secret && provided && provided === secret);

  if (!authorised) {
    const ctx = await getSession();
    authorised = Boolean(ctx && ctx.session.twoFaVerified && ctx.actor.role === Role.SUPER_ADMIN);
  }
  if (!authorised) return new Response("Unauthorized", { status: 401 });

  try {
    const summary = await runDailyAutomation(new Date());
    return Response.json({ ok: true, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[jobs tick error]", e);
    return new Response("Automation run failed.", { status: 500 });
  }
}

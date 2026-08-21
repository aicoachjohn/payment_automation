/**
 * Daily automation tick endpoint (Phase 10). Runs the idempotent automation service, so a
 * scheduler can call it once a day. Three auth paths:
 *   - Vercel Cron, which sends `Authorization: Bearer <CRON_SECRET>` on a GET,
 *   - any other headless scheduler, via `x-cron-secret` matching CRON_SECRET,
 *   - a Super Admin session, for the "run now" button.
 * Idempotent: re-calling for the same IST day sends nothing twice.
 */
import { getSession } from "@/server/auth/session";
import { Role } from "@prisma/client";
import { runDailyAutomation } from "@/server/services/automation";
import { timingSafeEqual } from "node:crypto";

// The tick walks every open lead and dispatches reminders, so it needs headroom and must
// never be served from a cache — Vercel would otherwise treat the cron GET as static.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Constant-time compare, so the secret cannot be recovered a character at a time. */
function secretMatches(provided: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<Response> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
  let authorised = secretMatches(req.headers.get("x-cron-secret")) || secretMatches(bearer);

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

export const POST = handle;
/** Vercel Cron only issues GET. Same guard, same idempotency. */
export const GET = handle;

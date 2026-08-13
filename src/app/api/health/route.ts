/**
 * Health-check endpoint (Phase 12 deployment / NFR-04 uptime monitoring). Returns 200
 * with a DB-connectivity probe and build info, or 503 if the database is unreachable.
 * Emits NO personal data, amounts or ids — safe for an external uptime monitor to poll.
 */
import { db } from "@/server/db";
import { log, newRequestId } from "@/server/log";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = newRequestId();
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const body = {
      status: "ok",
      db: "up",
      uptimeMs: Math.round(process.uptime() * 1000),
      version: process.env.APP_VERSION ?? "dev",
      time: new Date().toISOString(),
    };
    log({ requestId, event: "health_check", db: "up", latencyMs: Date.now() - startedAt });
    return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    log({ requestId, event: "health_check", level: "error", db: "down", latencyMs: Date.now() - startedAt });
    return Response.json({ status: "degraded", db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

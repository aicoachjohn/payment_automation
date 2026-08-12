/**
 * System-wide audit-trail CSV export (FR-ADM-10, FR-AUD-04/05). Authorised roles only
 * (audit:read:all), re-verified on the request. The export itself is logged.
 */
import { getSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { auditTrailCsv, type AuditLogFilters } from "@/server/services/audit-log";

export async function GET(req: Request) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(ctx.actor.role, "audit:read:all")) return new Response("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const filters: AuditLogFilters = {
    performedBy: sp.get("performedBy") || undefined,
    entityType: sp.get("entityType") || undefined,
    action: sp.get("action") || undefined,
    entityId: sp.get("entityId") || undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
  };
  const csv = await auditTrailCsv(ctx.actor, filters);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-trail.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

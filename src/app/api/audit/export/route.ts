/**
 * Export the audit queue to CSV with the applied filters intact (FR-DM-12/13).
 * Auditor-only; re-verified on the request.
 */
import { AuditStatus, PaymentType } from "@prisma/client";
import { getSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { auditQueueCsv } from "@/server/services/audit-decisions";

export async function GET(req: Request) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(ctx.actor.role, "payment:audit")) return new Response("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const csv = await auditQueueCsv(ctx.actor, {
    status: (sp.get("status") as AuditStatus) || undefined,
    paymentType: (sp.get("paymentType") as PaymentType) || undefined,
    salespersonId: sp.get("salespersonId") || undefined,
    search: sp.get("search") || undefined,
  });
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-queue.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

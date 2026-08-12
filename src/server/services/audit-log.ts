/**
 * System-wide audit-trail search + export (FR-AUD-04, FR-ADM-10). The audit trail is
 * append-only and retained ≥ 7 years (FR-AUD-03) — this module only READS it, and logs
 * each export (FR-AUD-05). Authorised roles (audit:read:all) may search and export.
 */
import "server-only";
import { type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";

export interface AuditLogFilters {
  performedBy?: string;
  entityType?: string;
  action?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

export interface AuditLogRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  byName: string;
  role: string;
  at: string;
  ip: string | null;
}

function buildWhere(filters: AuditLogFilters): Prisma.AuditTrailWhereInput {
  const where: Prisma.AuditTrailWhereInput = {};
  if (filters.performedBy) where.performedBy = filters.performedBy;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.action) where.action = { contains: filters.action, mode: "insensitive" };
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.from || filters.to) {
    where.performedAt = {};
    if (filters.from) where.performedAt.gte = new Date(filters.from);
    if (filters.to) {
      const to = new Date(filters.to);
      to.setUTCHours(23, 59, 59, 999);
      where.performedAt.lte = to;
    }
  }
  return where;
}

export async function searchAuditTrail(actor: Actor, filters: AuditLogFilters = {}, limit = 500): Promise<AuditLogRow[]> {
  requirePermission(actor, "audit:read:all");
  const rows = await db.auditTrail.findMany({ where: buildWhere(filters), orderBy: { performedAt: "desc" }, take: limit });
  const actorIds = [...new Set(rows.map((r) => r.performedBy))];
  const users = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((e) => ({
    id: e.id,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    field: e.fieldName,
    oldValue: e.oldValue,
    newValue: e.newValue,
    byName: nameOf.get(e.performedBy) ?? "System",
    role: e.performedByRole,
    at: e.performedAt.toISOString(),
    ip: e.ipAddress,
  }));
}

/** Distinct entity types and actions, for the filter dropdowns. */
export async function auditFilterOptions(actor: Actor): Promise<{ entityTypes: string[]; actions: string[] }> {
  requirePermission(actor, "audit:read:all");
  const [types, actions] = await Promise.all([
    db.auditTrail.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    db.auditTrail.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return { entityTypes: types.map((t) => t.entityType), actions: actions.map((a) => a.action) };
}

/** CSV of the audit log with filters intact; logs the export (FR-AUD-05). */
export async function auditTrailCsv(actor: Actor, filters: AuditLogFilters = {}): Promise<string> {
  const rows = await searchAuditTrail(actor, filters, 5000);
  await db.$transaction(async (tx) => {
    await writeAudit(tx, {
      entityType: "AuditReport",
      entityId: "audit-trail",
      action: "EXPORT",
      changes: [
        { field: "filters", oldValue: null, newValue: JSON.stringify(filters) },
        { field: "recordCount", oldValue: null, newValue: rows.length },
      ],
      actor,
    });
  });
  const header = ["Timestamp", "User", "Role", "Action", "Entity", "EntityID", "Field", "Old", "New", "IP"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.at, r.byName, r.role, r.action, r.entityType, r.entityId, r.field ?? "", r.oldValue ?? "", r.newValue ?? "", r.ip ?? ""]
      .map((v) => escape(String(v)))
      .join(","),
  );
  return [header.map(escape).join(","), ...lines].join("\r\n");
}

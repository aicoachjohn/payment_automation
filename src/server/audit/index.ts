/**
 * Immutable audit-trail writer (FR-AUD-01/02, BR-14).
 *
 * `writeAudit` runs INSIDE the caller's Prisma transaction, so an audit entry can
 * never be missing for a change that succeeded (and is rolled back with it if the
 * change fails). It writes one row per changed field — field-level before/after is
 * queryable (FR-DM-34, FR-DM-35). Values are serialised to strings; we never dump a
 * whole entity payload of personal data as a single blob.
 *
 * Audit rows are append-only: the Prisma client extension (src/server/db) blocks
 * update/delete at runtime, and the migration REVOKEs UPDATE/DELETE at the DB level.
 */
import type { Role } from "@prisma/client";
import type { DbTx } from "../db";

export interface AuditActor {
  userId: string;
  role: Role;
}

export interface AuditChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface WriteAuditArgs {
  entityType: string;
  entityId: string;
  action: string;
  /** One entry per changed field. May be empty for actions with no field diff. */
  changes?: AuditChange[];
  actor: AuditActor;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Serialise an audit value to a string. null/undefined → null; objects → JSON. */
function serialise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  // Decimal (and other objects) expose toString(); fall back to JSON for plain objects.
  if (typeof (value as { toString?: unknown }).toString === "function") {
    const s = (value as { toString(): string }).toString();
    if (s !== "[object Object]") return s;
  }
  return JSON.stringify(value);
}

/**
 * Write one audit row per changed field within the caller's transaction.
 *
 * @param tx  The Prisma transaction client from `db.$transaction((tx) => …)`.
 */
export async function writeAudit(tx: DbTx, args: WriteAuditArgs): Promise<void> {
  const { entityType, entityId, action, actor, ip, userAgent, requestId } = args;
  const changes = args.changes ?? [];

  const base = {
    entityType,
    entityId,
    action,
    performedBy: actor.userId,
    performedByRole: actor.role,
    ipAddress: ip ?? null,
    userAgent: userAgent ?? null,
    requestId: requestId ?? null,
  };

  const rows =
    changes.length === 0
      ? [{ ...base, fieldName: null, oldValue: null, newValue: null }]
      : changes.map((c) => ({
          ...base,
          fieldName: c.field,
          oldValue: serialise(c.oldValue),
          newValue: serialise(c.newValue),
        }));

  await tx.auditTrail.createMany({ data: rows });
}

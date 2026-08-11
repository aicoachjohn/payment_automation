/**
 * The FRD §2.2 Role-Based Access Control matrix, encoded as DATA (not scattered
 * if-statements). This module is the single source of truth for "who may do what",
 * enforced server-side on every request (FR-SEC-02/03, NFR-07). The matrix unit test
 * (tests/unit/permissions.test.ts) walks every cell and is the specification.
 *
 * Key invariants baked in here:
 *  - FINANCE_REVIEWER holds NO write permission of any kind (BR-18) — reads only.
 *  - There is no `payment:edit-amount` permission ANYWHERE — the Super Admin cannot
 *    directly edit a payment amount/date/Txn ID (FR-SA-08, BR-24). It simply does not
 *    exist as a grantable capability.
 *  - Only DATA_MGMT_AUDITOR holds `payment:audit`. The Super Admin obtains it solely
 *    via the delegated-audit path (Phase 9), never through this base map.
 *  - A SALESPERSON may edit a payment record only while it is PENDING_AUDIT or
 *    CORRECTION_REQUIRED and only if they own the lead — `canEditPaymentRecord`.
 */
import { Role, AuditStatus } from "@prisma/client";

export type Permission =
  | "lead:create"
  | "lead:read:own"
  | "lead:read:all"
  | "lead:update:own"
  | "lead:update:all"
  | "payment:create"
  | "payment:update:own"
  | "payment:audit"
  | "payment:reverse-audit"
  | "finance:read"
  | "customer:read"
  | "concession:create"
  | "concession:approve"
  | "fee:unlock"
  | "pricing:read"
  | "pricing:write"
  | "user:manage"
  | "config:write"
  | "audit:read:own"
  | "audit:read:all"
  | "audit:export"
  | "report:read:own"
  | "report:read:all";

/**
 * ROLE_PERMISSIONS — the FRD §2.2 grid. Each role maps to the exact set of
 * permissions its row grants. Deny-by-default: anything not listed is refused.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  [Role.SALESPERSON]: new Set<Permission>([
    "lead:create",
    "lead:read:own",
    "lead:update:own",
    "payment:create",
    "payment:update:own",
    "concession:create",
    "customer:read",
    "audit:read:own",
    "report:read:own",
  ]),
  [Role.SALES_MANAGER]: new Set<Permission>([
    "lead:read:all",
    "lead:update:all",
    "payment:create",
    "payment:update:own",
    "finance:read",
    "customer:read",
    "concession:create",
    "concession:approve",
    "fee:unlock",
    "pricing:read",
    "pricing:write",
    "audit:read:all",
    "report:read:all",
  ]),
  [Role.DATA_MGMT_AUDITOR]: new Set<Permission>([
    "lead:read:all",
    "payment:audit",
    "finance:read",
    "customer:read",
    "audit:read:all",
    "report:read:all",
  ]),
  // Finance is read-only BY DESIGN (BR-18) — every permission below is a read.
  [Role.FINANCE_REVIEWER]: new Set<Permission>([
    "lead:read:all",
    "finance:read",
    "customer:read",
    "pricing:read",
    "audit:read:all",
    "report:read:all",
  ]),
  [Role.SUPER_ADMIN]: new Set<Permission>([
    "lead:read:all",
    "lead:update:all",
    "payment:reverse-audit",
    "finance:read",
    "customer:read",
    "concession:approve",
    "fee:unlock",
    "pricing:read",
    "pricing:write",
    "user:manage",
    "config:write",
    "audit:read:all",
    "audit:export",
    "report:read:all",
  ]),
};

/** A minimal identity for authorisation. Loaded fresh from the DB each request. */
export interface Actor {
  userId: string;
  role: Role;
}

/** Thrown when authorisation fails. Carries a safe, user-facing message (NFR-11). */
export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Pure predicate: does this role hold this permission? */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Guard: throw unless the actor holds the permission. Use at the top of every action. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) {
    throw new AuthorizationError();
  }
}

/**
 * Record-ownership check for `:own`-scoped access. Roles that hold the corresponding
 * `:all` capability (managers, auditor, finance, super admin) pass regardless; a
 * salesperson passes only for records they own.
 */
export function canAccessLead(
  actor: Actor,
  lead: { salespersonId: string },
): boolean {
  if (hasPermission(actor.role, "lead:read:all")) return true;
  return lead.salespersonId === actor.userId;
}

/** Guard form of {@link canAccessLead}. */
export function requireRecordAccess(
  actor: Actor,
  lead: { salespersonId: string },
): void {
  if (!canAccessLead(actor, lead)) {
    throw new AuthorizationError();
  }
}

/**
 * Whether the actor may edit a specific payment RECORD (amount/date/Txn ID/proof).
 * Encodes the FRD footnote as a function, not a comment: a salesperson may edit only
 * while PENDING_AUDIT or CORRECTION_REQUIRED and only for a lead they own. Managers may
 * edit team payment records. No one else may write payment records — and note there is
 * no path here to edit an APPROVED/REJECTED payment (locked), for anyone.
 */
export function canEditPaymentRecord(
  actor: Actor,
  payment: { auditStatus: AuditStatus; lead: { salespersonId: string } },
): boolean {
  const editable =
    payment.auditStatus === AuditStatus.PENDING_AUDIT ||
    payment.auditStatus === AuditStatus.CORRECTION_REQUIRED;
  if (!editable) return false;

  if (actor.role === Role.SALESPERSON) {
    return (
      hasPermission(actor.role, "payment:update:own") &&
      payment.lead.salespersonId === actor.userId
    );
  }
  if (actor.role === Role.SALES_MANAGER) {
    return hasPermission(actor.role, "payment:update:own");
  }
  return false;
}

/** Guard form of {@link canEditPaymentRecord}. */
export function requirePaymentEditable(
  actor: Actor,
  payment: { auditStatus: AuditStatus; lead: { salespersonId: string } },
): void {
  if (!canEditPaymentRecord(actor, payment)) {
    throw new AuthorizationError(
      "This payment can no longer be edited, or it is not yours to edit.",
    );
  }
}

/** Which dashboard a role lands on after login (FR-AUTH-03). */
export const ROLE_HOME: Record<Role, string> = {
  [Role.SALESPERSON]: "/sales",
  [Role.SALES_MANAGER]: "/sales",
  [Role.DATA_MGMT_AUDITOR]: "/audit",
  [Role.FINANCE_REVIEWER]: "/finance",
  [Role.SUPER_ADMIN]: "/admin",
};

/** Route-prefix → the roles allowed to enter it. Used by middleware and layouts. */
export const ROUTE_ACCESS: { prefix: string; roles: ReadonlySet<Role> }[] = [
  { prefix: "/sales", roles: new Set([Role.SALESPERSON, Role.SALES_MANAGER]) },
  { prefix: "/audit", roles: new Set([Role.DATA_MGMT_AUDITOR]) },
  { prefix: "/finance", roles: new Set([Role.FINANCE_REVIEWER]) },
  { prefix: "/admin", roles: new Set([Role.SUPER_ADMIN]) },
];

/** The role allowed at a path, or null if the path is not a protected role area. */
export function rolesForPath(pathname: string): ReadonlySet<Role> | null {
  const match = ROUTE_ACCESS.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  return match ? match.roles : null;
}

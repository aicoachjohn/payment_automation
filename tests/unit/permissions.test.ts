import { describe, expect, it } from "vitest";
import { Role, AuditStatus } from "@prisma/client";
import {
  ROLE_PERMISSIONS,
  hasPermission,
  requirePermission,
  canAccessLead,
  canEditPaymentRecord,
  AuthorizationError,
  type Permission,
  type Actor,
} from "@/server/auth/permissions";

/**
 * The FRD §2.2 matrix, transcribed cell-by-cell as the EXPECTED grid. This table is
 * the specification: for every (permission, role) cell we assert the permission layer
 * agrees. If the FRD and this table ever disagree, fix the code — not this table.
 */
const EXPECTED: Record<Permission, Role[]> = {
  "lead:create": [Role.SALESPERSON],
  "lead:read:own": [Role.SALESPERSON],
  "lead:read:all": [Role.SALES_MANAGER, Role.DATA_MGMT_AUDITOR, Role.FINANCE_REVIEWER, Role.SUPER_ADMIN],
  "lead:update:own": [Role.SALESPERSON],
  "lead:update:all": [Role.SALES_MANAGER, Role.SUPER_ADMIN],
  "payment:create": [Role.SALESPERSON, Role.SALES_MANAGER],
  "payment:update:own": [Role.SALESPERSON, Role.SALES_MANAGER],
  "payment:audit": [Role.DATA_MGMT_AUDITOR],
  "payment:reverse-audit": [Role.SUPER_ADMIN],
  "finance:read": [Role.SALES_MANAGER, Role.DATA_MGMT_AUDITOR, Role.FINANCE_REVIEWER, Role.SUPER_ADMIN],
  "customer:read": [Role.SALESPERSON, Role.SALES_MANAGER, Role.DATA_MGMT_AUDITOR, Role.FINANCE_REVIEWER, Role.SUPER_ADMIN],
  "concession:create": [Role.SALESPERSON, Role.SALES_MANAGER],
  "concession:approve": [Role.SALES_MANAGER, Role.SUPER_ADMIN],
  "fee:unlock": [Role.SALES_MANAGER, Role.SUPER_ADMIN],
  "pricing:read": [Role.SALES_MANAGER, Role.FINANCE_REVIEWER, Role.SUPER_ADMIN],
  "pricing:write": [Role.SALES_MANAGER, Role.SUPER_ADMIN],
  "user:manage": [Role.SUPER_ADMIN],
  "config:write": [Role.SUPER_ADMIN],
  "audit:read:own": [Role.SALESPERSON],
  "audit:read:all": [Role.SALES_MANAGER, Role.DATA_MGMT_AUDITOR, Role.FINANCE_REVIEWER, Role.SUPER_ADMIN],
  "audit:export": [Role.SUPER_ADMIN],
  "report:read:own": [Role.SALESPERSON],
  "report:read:all": [Role.SALES_MANAGER, Role.DATA_MGMT_AUDITOR, Role.FINANCE_REVIEWER, Role.SUPER_ADMIN],
};

const ALL_ROLES = Object.values(Role);
const ALL_PERMISSIONS = Object.keys(EXPECTED) as Permission[];

// Every permission that grants a WRITE/APPROVE (used for the BR-18 Finance check).
const WRITE_PERMISSIONS: Permission[] = [
  "lead:create", "lead:update:own", "lead:update:all",
  "payment:create", "payment:update:own", "payment:audit", "payment:reverse-audit",
  "concession:create", "concession:approve", "fee:unlock",
  "pricing:write", "user:manage", "config:write", "audit:export",
];

describe("permission matrix — walks every FRD §2.2 cell", () => {
  for (const permission of ALL_PERMISSIONS) {
    for (const role of ALL_ROLES) {
      const shouldHave = EXPECTED[permission].includes(role);
      it(`${role} ${shouldHave ? "HAS" : "lacks"} ${permission}`, () => {
        expect(hasPermission(role, permission)).toBe(shouldHave);
      });
    }
  }

  it("ROLE_PERMISSIONS grants nothing beyond the FRD matrix (no extra cells)", () => {
    for (const role of ALL_ROLES) {
      for (const granted of ROLE_PERMISSIONS[role]) {
        expect(EXPECTED[granted], `${role} unexpectedly has ${granted}`).toContain(role);
      }
    }
  });
});

describe("permission matrix — the inviolable invariants", () => {
  it("FINANCE_REVIEWER has NO write permission of any kind (BR-18)", () => {
    for (const w of WRITE_PERMISSIONS) {
      expect(hasPermission(Role.FINANCE_REVIEWER, w)).toBe(false);
    }
  });

  it("`payment:edit-amount` does not exist as a permission anywhere (FR-SA-08, BR-24)", () => {
    for (const role of ALL_ROLES) {
      // cast: the token is intentionally not part of the Permission union
      expect(ROLE_PERMISSIONS[role].has("payment:edit-amount" as Permission)).toBe(false);
    }
    expect(ALL_PERMISSIONS).not.toContain("payment:edit-amount");
  });

  it("only DATA_MGMT_AUDITOR holds payment:audit (SA gets it only via delegation)", () => {
    const holders = ALL_ROLES.filter((r) => hasPermission(r, "payment:audit"));
    expect(holders).toEqual([Role.DATA_MGMT_AUDITOR]);
    expect(hasPermission(Role.SUPER_ADMIN, "payment:audit")).toBe(false);
  });

  it("SUPER_ADMIN cannot create or update payment records directly", () => {
    expect(hasPermission(Role.SUPER_ADMIN, "payment:create")).toBe(false);
    expect(hasPermission(Role.SUPER_ADMIN, "payment:update:own")).toBe(false);
  });

  it("requirePermission throws AuthorizationError when denied", () => {
    const finance: Actor = { userId: "u1", role: Role.FINANCE_REVIEWER };
    expect(() => requirePermission(finance, "payment:audit")).toThrow(AuthorizationError);
    const auditor: Actor = { userId: "u2", role: Role.DATA_MGMT_AUDITOR };
    expect(() => requirePermission(auditor, "payment:audit")).not.toThrow();
  });
});

describe("record access & payment editability", () => {
  const owner: Actor = { userId: "sales1", role: Role.SALESPERSON };
  const otherSales: Actor = { userId: "sales2", role: Role.SALESPERSON };
  const manager: Actor = { userId: "mgr", role: Role.SALES_MANAGER };
  const finance: Actor = { userId: "fin", role: Role.FINANCE_REVIEWER };

  it("a salesperson can access only their own lead; managers/finance access all", () => {
    const lead = { salespersonId: "sales1" };
    expect(canAccessLead(owner, lead)).toBe(true);
    expect(canAccessLead(otherSales, lead)).toBe(false);
    expect(canAccessLead(manager, lead)).toBe(true);
    expect(canAccessLead(finance, lead)).toBe(true);
  });

  it("salesperson may edit a payment only while PENDING/CORRECTION and only if owned", () => {
    const own = { lead: { salespersonId: "sales1" } };
    expect(canEditPaymentRecord(owner, { ...own, auditStatus: AuditStatus.PENDING_AUDIT })).toBe(true);
    expect(canEditPaymentRecord(owner, { ...own, auditStatus: AuditStatus.CORRECTION_REQUIRED })).toBe(true);
    expect(canEditPaymentRecord(owner, { ...own, auditStatus: AuditStatus.APPROVED })).toBe(false);
    expect(canEditPaymentRecord(owner, { ...own, auditStatus: AuditStatus.REJECTED })).toBe(false);
    expect(canEditPaymentRecord(owner, { ...own, auditStatus: AuditStatus.RESUBMITTED })).toBe(false);
    // not the owner
    expect(canEditPaymentRecord(otherSales, { ...own, auditStatus: AuditStatus.PENDING_AUDIT })).toBe(false);
  });

  it("finance and auditor can NEVER edit a payment record", () => {
    const p = { auditStatus: AuditStatus.PENDING_AUDIT, lead: { salespersonId: "sales1" } };
    expect(canEditPaymentRecord(finance, p)).toBe(false);
    expect(canEditPaymentRecord({ userId: "n", role: Role.DATA_MGMT_AUDITOR }, p)).toBe(false);
    expect(canEditPaymentRecord({ userId: "sa", role: Role.SUPER_ADMIN }, p)).toBe(false);
  });
});

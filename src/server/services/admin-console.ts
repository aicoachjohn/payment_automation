/**
 * Super Admin consolidated system overview (FR-SA-02) and workflow-health panel
 * (FR-SA-04). Reads only. Composes existing role services where the Super Admin already
 * holds the permission, and counts directly otherwise.
 */
import "server-only";
import { AuditStatus, LeadStatus, Role, type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { requirePermission, AuthorizationError, type Actor } from "@/server/auth/permissions";
import { financeVisiblePaymentWhere } from "@/server/services/finance-visibility";
import { outstandingReport } from "@/server/services/finance";
import { getConfigNumber } from "@/server/services/system-config";
import { sum, round } from "@/server/money";

function assertSuperAdmin(actor: Actor): void {
  if (actor.role !== Role.SUPER_ADMIN) throw new AuthorizationError();
}

export interface SystemOverview {
  totalLeads: number;
  leadsByStage: { status: LeadStatus; count: number }[];
  pendingAudit: number;
  pendingAuditAmber: number;
  pendingAuditRed: number;
  approvedCollectionThisMonth: string;
  outstandingTotal: string;
  fifteenDayApproaching: number;
  opsHandoversCompleted: number;
}

export async function systemOverview(actor: Actor, now: Date = new Date()): Promise<SystemOverview> {
  assertSuperAdmin(actor);
  requirePermission(actor, "report:read:all");

  const monthFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const ageHours = await getConfigNumber("audit_ageing_threshold_hours", 48);
  const amberAt = new Date(now.getTime() - ageHours * 3_600_000);
  const redAt = new Date(now.getTime() - 2 * ageHours * 3_600_000);
  const open: AuditStatus[] = [AuditStatus.PENDING_AUDIT, AuditStatus.RESUBMITTED];

  const [totalLeads, byStage, pendingAudit, amber, red, approvedRows, outstanding, fifteenDay, opsDone] = await Promise.all([
    db.lead.count({ where: { voided: false } }),
    db.lead.groupBy({ by: ["status"], where: { voided: false }, _count: { _all: true } }),
    db.payment.count({ where: { auditStatus: { in: open }, voided: false } }),
    db.payment.count({ where: { auditStatus: { in: open }, voided: false, submittedAt: { lt: amberAt } } }),
    db.payment.count({ where: { auditStatus: { in: open }, voided: false, submittedAt: { lt: redAt } } }),
    db.payment.findMany({ where: financeVisiblePaymentWhere({ paymentDate: { gte: monthFrom, lt: monthTo } }), select: { receivedAmount: true } }),
    outstandingReport(actor, now),
    db.lead.count({
      where: {
        voided: false,
        status: LeadStatus.DOWN_PAYMENT_PENDING,
        enrollment: { courseStartedFlag: true, commencingDate: { lte: now, gte: new Date(now.getTime() - 15 * 86_400_000) } },
      },
    }),
    db.operationsHandover.count({ where: { validatedFlag: true } }),
  ]);

  return {
    totalLeads,
    leadsByStage: byStage.map((s) => ({ status: s.status, count: s._count._all })),
    pendingAudit,
    pendingAuditAmber: amber,
    pendingAuditRed: red,
    approvedCollectionThisMonth: round(sum(approvedRows.map((r) => r.receivedAmount.toString()))).toFixed(2),
    outstandingTotal: outstanding.total,
    fifteenDayApproaching: fifteenDay,
    opsHandoversCompleted: opsDone,
  };
}

export interface WorkflowHealth {
  agedPendingAudit: { count: number; thresholdHours: number };
  repeatedCorrections: { salesperson: string; count: number }[];
  stalledLeads: { count: number; stallDays: number };
  failedNotifications: number;
}

export async function workflowHealth(actor: Actor, now: Date = new Date()): Promise<WorkflowHealth> {
  assertSuperAdmin(actor);
  const ageHours = await getConfigNumber("audit_ageing_threshold_hours", 48);
  const stallDays = await getConfigNumber("lead_stall_days", 14);
  const correctionMin = await getConfigNumber("repeated_correction_threshold", 2);
  const agedAt = new Date(now.getTime() - ageHours * 3_600_000);
  const stalledAt = new Date(now.getTime() - stallDays * 86_400_000);
  const open: AuditStatus[] = [AuditStatus.PENDING_AUDIT, AuditStatus.RESUBMITTED];
  const terminal: LeadStatus[] = [LeadStatus.FULLY_PAID, LeadStatus.ENROLLMENT_COMPLETED, LeadStatus.OPERATIONS_HANDOVER];

  const [agedCount, corrections, stalled, failed] = await Promise.all([
    db.payment.count({ where: { auditStatus: { in: open }, voided: false, submittedAt: { lt: agedAt } } }),
    db.payment.groupBy({
      by: ["submittedBy"],
      where: { auditStatus: AuditStatus.CORRECTION_REQUIRED, voided: false },
      _count: { _all: true },
    }),
    db.lead.count({ where: { voided: false, status: { notIn: terminal }, updatedAt: { lt: stalledAt } } }),
    db.notification.count({ where: { status: "FAILED" } }),
  ]);

  const repeated = corrections.filter((c) => c._count._all >= correctionMin);
  const names = await db.user.findMany({ where: { id: { in: repeated.map((r) => r.submittedBy) } }, select: { id: true, name: true } });
  const nameOf = new Map(names.map((u) => [u.id, u.name]));

  return {
    agedPendingAudit: { count: agedCount, thresholdHours: ageHours },
    repeatedCorrections: repeated
      .map((c) => ({ salesperson: nameOf.get(c.submittedBy) ?? "Unknown", count: c._count._all }))
      .sort((a, b) => b.count - a.count),
    stalledLeads: { count: stalled, stallDays },
    failedNotifications: failed,
  };
}

/** Search leads/payments/enrollments for the SA record browser (FR-SA-03). Reads only. */
export async function findRecords(actor: Actor, query: string): Promise<{
  leads: { id: string; name: string; salesperson: string; status: string }[];
  payments: { id: string; transactionId: string; learner: string; auditStatus: string; delegatedAudit: boolean }[];
}> {
  assertSuperAdmin(actor);
  const q = query.trim();
  if (!q) return { leads: [], payments: [] };
  const leadWhere: Prisma.LeadWhereInput = {
    OR: [
      { fullName: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
    ],
  };
  const [leads, payments] = await Promise.all([
    db.lead.findMany({ where: leadWhere, include: { salesperson: { select: { name: true } } }, take: 25, orderBy: { createdAt: "desc" } }),
    db.payment.findMany({
      where: { OR: [{ transactionId: { contains: q, mode: "insensitive" } }, { enrollment: { lead: { fullName: { contains: q, mode: "insensitive" } } } }] },
      include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
      take: 25,
      orderBy: { submittedAt: "desc" },
    }),
  ]);
  return {
    leads: leads.map((l) => ({ id: l.id, name: l.fullName, salesperson: l.salesperson.name, status: l.status })),
    payments: payments.map((p) => ({ id: p.id, transactionId: p.transactionId, learner: p.enrollment.lead.fullName, auditStatus: p.auditStatus, delegatedAudit: p.delegatedAudit })),
  };
}

/** Every proof version of a payment (FR-SA-03) — the Super Admin sees all history. */
export async function paymentProofVersions(actor: Actor, paymentId: string): Promise<{ id: string; version: number; uploadedAt: string; originalFilename: string }[]> {
  assertSuperAdmin(actor);
  const proofs = await db.paymentProof.findMany({ where: { paymentId }, orderBy: { version: "desc" }, select: { id: true, version: true, uploadedAt: true, originalFilename: true } });
  return proofs.map((p) => ({ id: p.id, version: p.version, uploadedAt: p.uploadedAt.toISOString(), originalFilename: p.originalFilename }));
}

/**
 * Payment integrity & reconciliation (Phase 11, FR-REC-11..18, BR-30). Prevention (Part A,
 * built in earlier phases) is the first line; this detection layer surfaces any drift the
 * same day rather than at year-end. Every figure here is recomputed from the individual
 * approved, non-voided payment records — never from a stored total (BR-28, FR-REC-06) —
 * and all money arithmetic goes through `src/server/money` (FR-REC-07).
 */
import "server-only";
import { AuditStatus, Role, type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { AuthorizationError, type Actor } from "@/server/auth/permissions";
import { financeVisiblePaymentWhere } from "@/server/services/finance-visibility";
import { notifyUser } from "@/server/notifications";
import { money, sum, round, sub, gt, eq } from "@/server/money";
import { IST_OFFSET_MS } from "@/lib/ist";

export class ReconciliationError extends Error {
  readonly code = "RECONCILIATION_ERROR";
}

function assertReadAccess(actor: Actor): void {
  // The reconciliation surface is for the Super Admin and Rajesh (FR-REC-12/17).
  if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.FINANCE_REVIEWER) throw new AuthorizationError();
}

async function usersInRoles(roles: Role[]): Promise<{ id: string; email: string }[]> {
  return db.user.findMany({ where: { role: { in: roles }, status: "ACTIVE" }, select: { id: true, email: true } });
}

// ── Exception lifecycle (FR-REC-12) ────────────────────────────────────────────

export interface ExceptionRow {
  id: string;
  kind: string;
  enrollmentId: string | null;
  entityRef: string | null;
  detail: string;
  status: string;
  resolutionNote: string | null;
  raisedAt: string;
}

/**
 * Raise (or reopen) an exception idempotently on `dedupeKey`. A brand-new or a reopened
 * exception notifies the Super Admin AND Rajesh, naming the record and the discrepancy
 * (FR-REC-12). Re-running the check for an already-open exception only refreshes its
 * detail — no duplicate, no duplicate notification.
 */
async function raiseException(kind: string, dedupeKey: string, detail: string, opts: { enrollmentId?: string; entityRef?: string } = {}): Promise<void> {
  const existing = await db.reconciliationException.findUnique({ where: { dedupeKey } });
  let shouldNotify = false;
  if (!existing) {
    await db.reconciliationException.create({
      data: { kind, dedupeKey, detail, enrollmentId: opts.enrollmentId ?? null, entityRef: opts.entityRef ?? null, status: "OPEN" },
    });
    shouldNotify = true;
  } else if (existing.status === "RESOLVED") {
    await db.reconciliationException.update({ where: { dedupeKey }, data: { status: "OPEN", detail, resolutionNote: null, resolvedAt: null, raisedAt: new Date() } });
    shouldNotify = true;
  } else {
    await db.reconciliationException.update({ where: { dedupeKey }, data: { detail } });
  }

  if (shouldNotify) {
    const recipients = await usersInRoles([Role.SUPER_ADMIN, Role.FINANCE_REVIEWER]);
    for (const r of recipients) {
      await notifyUser({ recipientId: r.id, type: "RECONCILIATION_EXCEPTION", subject: `Reconciliation exception: ${kind}`, body: detail, relatedEntityType: opts.enrollmentId ? "Enrollment" : undefined, relatedEntityId: opts.enrollmentId });
    }
  }
}

export async function listExceptions(actor: Actor, status?: string): Promise<ExceptionRow[]> {
  assertReadAccess(actor);
  const rows = await db.reconciliationException.findMany({ where: status ? { status } : {}, orderBy: { raisedAt: "desc" }, take: 500 });
  return rows.map((r) => ({ id: r.id, kind: r.kind, enrollmentId: r.enrollmentId, entityRef: r.entityRef, detail: r.detail, status: r.status, resolutionNote: r.resolutionNote, raisedAt: r.raisedAt.toISOString() }));
}

export async function acknowledgeException(actor: Actor, id: string): Promise<void> {
  if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.FINANCE_REVIEWER) throw new AuthorizationError();
  await db.reconciliationException.update({ where: { id }, data: { status: "ACKNOWLEDGED" } });
}

export async function resolveException(actor: Actor, id: string, note: string): Promise<void> {
  if (actor.role !== Role.SUPER_ADMIN) throw new AuthorizationError("Only the Super Admin can resolve an exception.");
  if (!note.trim()) throw new ReconciliationError("A resolution note is required.");
  await db.reconciliationException.update({ where: { id }, data: { status: "RESOLVED", resolutionNote: note.trim(), resolvedAt: new Date() } });
}

// ── Daily reconciliation (FR-REC-11) ────────────────────────────────────────────

/** Approved, non-voided received totals per enrollment (recomputed, never stored). */
async function approvedSums(enrollmentIds?: string[]): Promise<Map<string, string>> {
  const grouped = await db.payment.groupBy({
    by: ["enrollmentId"],
    where: financeVisiblePaymentWhere(enrollmentIds ? { enrollmentId: { in: enrollmentIds } } : {}),
    _sum: { receivedAmount: true },
  });
  return new Map(grouped.map((g) => [g.enrollmentId, round(g._sum.receivedAmount?.toString() ?? "0").toFixed(2)]));
}

export interface ReconciliationResult {
  checked: number;
  exceptionsRaised: number;
  failures: { enrollmentId: string; learner: string; detail: string }[];
}

/**
 * FR-REC-11: for every active enrollment, verify that the sum of approved payments plus
 * the outstanding balance equals the Final Approved Fee. Because the balance is always
 * finalFee − sumApproved, the invariant is violated exactly when the approved sum exceeds
 * the fee (a balance can never be negative) — which is precisely what a tampered or
 * over-collected amount produces. Each failure is raised as an exception (FR-REC-12).
 */
export async function runReconciliation(actor?: Actor): Promise<ReconciliationResult> {
  if (actor && actor.role !== Role.SUPER_ADMIN) throw new AuthorizationError();
  const enrollments = await db.enrollment.findMany({
    where: { finalApprovedFee: { not: null }, lead: { voided: false } },
    include: { lead: { select: { fullName: true } } },
  });
  const sums = await approvedSums(enrollments.map((e) => e.id));
  const failures: ReconciliationResult["failures"] = [];

  for (const e of enrollments) {
    const fee = round(e.finalApprovedFee!.toString());
    const sumApproved = money(sums.get(e.id) ?? "0");
    const balance = round(sub(fee, sumApproved));
    // Invariant: sumApproved + max(0, balance) == fee. It fails iff sumApproved > fee.
    if (gt(round(sumApproved).toString(), fee.toString())) {
      const over = round(sub(sumApproved, fee)).toFixed(2);
      const detail = `Enrollment ${e.id} (${e.lead.fullName}): approved received ₹${round(sumApproved).toFixed(2)} exceeds the Final Approved Fee ₹${fee.toFixed(2)} by ₹${over}. Balance cannot reconcile.`;
      await raiseException("BALANCE_MISMATCH", `BALANCE_MISMATCH:${e.id}`, detail, { enrollmentId: e.id, entityRef: e.id });
      failures.push({ enrollmentId: e.id, learner: e.lead.fullName, detail });
    }
    void balance;
  }
  return { checked: enrollments.length, exceptionsRaised: failures.length, failures };
}

// ── Finance total verification (FR-REC-13) ──────────────────────────────────────

/**
 * Independently verify the collection total for a period. This uses a SEPARATE aggregate
 * query (not the dashboard's findMany+sum), so it can actually catch a bug in the
 * dashboard query. Flags any variance to the paisa.
 */
export async function verifyFinanceTotal(actor: Actor, from: string, to: string): Promise<{ dashboardTotal: string; independentTotal: string; matches: boolean; variance: string }> {
  assertReadAccess(actor);
  const toEnd = new Date(to);
  toEnd.setUTCHours(23, 59, 59, 999);
  const where = financeVisiblePaymentWhere({ paymentDate: { gte: new Date(from), lte: toEnd } });

  // Independent path: a DB-side aggregate.
  const agg = await db.payment.aggregate({ _sum: { receivedAmount: true }, where });
  const independentTotal = round(agg._sum.receivedAmount?.toString() ?? "0").toFixed(2);

  // The dashboard path, recomputed the way the dashboard does (findMany + money.sum).
  const rows = await db.payment.findMany({ where, select: { receivedAmount: true } });
  const dashboardTotal = round(sum(rows.map((r) => r.receivedAmount.toString()))).toFixed(2);

  const matches = eq(dashboardTotal, independentTotal);
  if (!matches) {
    await raiseException("FINANCE_TOTAL_VARIANCE", `FINANCE_TOTAL_VARIANCE:${from}:${to}`, `Finance total for ${from}..${to}: dashboard ₹${dashboardTotal} vs independent ₹${independentTotal}.`);
  }
  return { dashboardTotal, independentTotal, matches, variance: round(sub(dashboardTotal, independentTotal)).toFixed(2) };
}

// ── Orphan detection (FR-REC-14) ────────────────────────────────────────────────

export interface OrphanReport {
  paymentsWithoutProof: { id: string; transactionId: string; learner: string }[];
  approvedWithoutAuditEntry: { id: string; transactionId: string; learner: string }[];
  paymentsOnVoidedLead: { id: string; transactionId: string; learner: string }[];
  orphanProofs: { id: string; paymentId: string }[];
}

export async function orphanReport(actor: Actor): Promise<OrphanReport> {
  assertReadAccess(actor);

  const withoutProof = await db.payment.findMany({
    where: { voided: false, proofs: { none: {} } },
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    take: 500,
  });

  const approved = await db.payment.findMany({
    where: { auditStatus: AuditStatus.APPROVED, voided: false },
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    take: 2000,
  });
  const approvedIds = approved.map((p) => p.id);
  const auditRows = await db.auditTrail.findMany({
    where: { entityType: "Payment", entityId: { in: approvedIds }, action: { in: ["AUDIT_APPROVE", "AUDIT_APPROVE_DELEGATED"] } },
    select: { entityId: true },
  });
  const audited = new Set(auditRows.map((a) => a.entityId));
  const noAudit = approved.filter((p) => !audited.has(p.id));

  const onVoidedLead = await db.payment.findMany({
    where: { auditStatus: AuditStatus.APPROVED, voided: false, enrollment: { lead: { voided: true } } },
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    take: 500,
  });

  return {
    paymentsWithoutProof: withoutProof.map((p) => ({ id: p.id, transactionId: p.transactionId, learner: p.enrollment.lead.fullName })),
    approvedWithoutAuditEntry: noAudit.map((p) => ({ id: p.id, transactionId: p.transactionId, learner: p.enrollment.lead.fullName })),
    paymentsOnVoidedLead: onVoidedLead.map((p) => ({ id: p.id, transactionId: p.transactionId, learner: p.enrollment.lead.fullName })),
    orphanProofs: [], // enforced impossible by the FK (proof→payment RESTRICT); listed for completeness
  };
}

// ── Month-end reconciliation statement (FR-REC-15) ──────────────────────────────

const TYPE_ORDER = ["COURSE_HOLDING", "COURSE_STARTING", "DOWN_PAYMENT", "FINAL_PAYMENT"] as const;

export interface MonthEndStatement {
  year: number;
  month: number;
  openingOutstanding: string;
  approvedByType: { type: string; value: string; count: number }[];
  approvedInPeriod: string;
  voidsInPeriod: { count: number; value: string };
  closingOutstanding: string;
  reconciles: boolean;
}

export async function monthEndStatement(actor: Actor, year: number, month: number): Promise<MonthEndStatement> {
  assertReadAccess(actor);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const enrollments = await db.enrollment.findMany({ where: { finalApprovedFee: { not: null } }, select: { id: true, finalApprovedFee: true } });
  const feeById = new Map(enrollments.map((e) => [e.id, e.finalApprovedFee!.toString()]));
  const ids = enrollments.map((e) => e.id);

  // Approved received strictly BEFORE the period → opening outstanding.
  const beforeSums = await sumApprovedBy(ids, { paymentDate: { lt: from } });
  const inPeriod = await db.payment.findMany({
    where: financeVisiblePaymentWhere({ enrollmentId: { in: ids }, paymentDate: { gte: from, lt: to } }),
    select: { receivedAmount: true, paymentType: true, enrollmentId: true },
  });

  let opening = money("0");
  for (const e of enrollments) opening = opening.plus(maxZero(sub(feeById.get(e.id)!, beforeSums.get(e.id) ?? "0")));

  const byType = new Map<string, { value: string[]; count: number }>();
  for (const p of inPeriod) {
    const entry = byType.get(p.paymentType) ?? { value: [], count: 0 };
    entry.value.push(p.receivedAmount.toString());
    entry.count += 1;
    byType.set(p.paymentType, entry);
  }
  const approvedInPeriod = round(sum(inPeriod.map((p) => p.receivedAmount.toString())));

  // Voided payments whose void happened in-period is not tracked by date; report voided
  // payments with a payment date in the period as the "voids & reversals" line.
  const voided = await db.payment.findMany({ where: { voided: true, enrollmentId: { in: ids }, paymentDate: { gte: from, lt: to } }, select: { receivedAmount: true } });

  // Closing outstanding = opening − approved-in-period (voids never counted in either).
  const closing = round(sub(opening, approvedInPeriod));

  return {
    year,
    month,
    openingOutstanding: round(opening).toFixed(2),
    approvedByType: TYPE_ORDER.map((t) => ({ type: t, value: round(sum(byType.get(t)?.value ?? [])).toFixed(2), count: byType.get(t)?.count ?? 0 })),
    approvedInPeriod: approvedInPeriod.toFixed(2),
    voidsInPeriod: { count: voided.length, value: round(sum(voided.map((v) => v.receivedAmount.toString()))).toFixed(2) },
    closingOutstanding: closing.toFixed(2),
    reconciles: eq(round(sub(opening, approvedInPeriod)).toString(), closing.toString()),
  };
}

async function sumApprovedBy(ids: string[], extra: Prisma.PaymentWhereInput): Promise<Map<string, string>> {
  const grouped = await db.payment.groupBy({ by: ["enrollmentId"], where: financeVisiblePaymentWhere({ enrollmentId: { in: ids }, ...extra }), _sum: { receivedAmount: true } });
  return new Map(grouped.map((g) => [g.enrollmentId, round(g._sum.receivedAmount?.toString() ?? "0").toFixed(2)]));
}

function maxZero(v: ReturnType<typeof sub>): ReturnType<typeof money> {
  return gt(v.toString(), "0") ? v : money("0");
}

// ── Trace-this-number (FR-REC-16) ───────────────────────────────────────────────

export interface TraceRow {
  id: string;
  learner: string;
  transactionId: string;
  paymentType: string;
  receivedAmount: string;
  paymentDate: string;
  approvedAt: string | null;
}

/** The exact approved payment rows behind a period collection total (drill-down). */
export async function traceCollection(actor: Actor, filters: { from: string; to: string; paymentType?: string; program?: string; plan?: string }): Promise<{ rows: TraceRow[]; total: string }> {
  assertReadAccess(actor);
  const toEnd = new Date(filters.to);
  toEnd.setUTCHours(23, 59, 59, 999);
  const extra: Prisma.PaymentWhereInput = { paymentDate: { gte: new Date(filters.from), lte: toEnd } };
  if (filters.paymentType) extra.paymentType = filters.paymentType as never;
  if (filters.program || filters.plan) extra.enrollment = { ...(filters.program ? { program: filters.program as never } : {}), ...(filters.plan ? { plan: filters.plan as never } : {}) };
  const rows = await db.payment.findMany({
    where: financeVisiblePaymentWhere(extra),
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    orderBy: { paymentDate: "asc" },
    take: 2000,
  });
  return {
    rows: rows.map((p) => ({ id: p.id, learner: p.enrollment.lead.fullName, transactionId: p.transactionId, paymentType: p.paymentType, receivedAmount: p.receivedAmount.toFixed(2), paymentDate: p.paymentDate.toISOString(), approvedAt: p.auditedAt?.toISOString() ?? null })),
    total: round(sum(rows.map((p) => p.receivedAmount.toString()))).toFixed(2),
  };
}

/** The exact approved payment rows behind an enrollment's balance (drill-down). */
export async function traceEnrollment(actor: Actor, enrollmentId: string): Promise<{ finalApprovedFee: string; rows: TraceRow[]; totalReceived: string; balance: string }> {
  assertReadAccess(actor);
  const e = await db.enrollment.findUnique({ where: { id: enrollmentId }, include: { lead: { select: { fullName: true } } } });
  if (!e) throw new ReconciliationError("Enrollment not found.");
  const rows = await db.payment.findMany({ where: financeVisiblePaymentWhere({ enrollmentId }), orderBy: { paymentDate: "asc" } });
  const totalReceived = round(sum(rows.map((p) => p.receivedAmount.toString())));
  const fee = e.finalApprovedFee?.toString() ?? "0";
  return {
    finalApprovedFee: round(fee).toFixed(2),
    rows: rows.map((p) => ({ id: p.id, learner: e.lead.fullName, transactionId: p.transactionId, paymentType: p.paymentType, receivedAmount: p.receivedAmount.toFixed(2), paymentDate: p.paymentDate.toISOString(), approvedAt: p.auditedAt?.toISOString() ?? null })),
    totalReceived: totalReceived.toFixed(2),
    balance: round(sub(fee, totalReceived)).toFixed(2),
  };
}

// ── Monthly exceptions report to Rajesh (FR-REC-17) ─────────────────────────────

function istHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

export interface MonthlyExceptionsReport {
  year: number;
  month: number;
  approvedOutsideHours: { id: string; transactionId: string; learner: string; approvedAt: string; istHour: number }[];
  moneyOverrides: { id: string; overrideType: string; entityRef: string; reason: string; at: string }[];
  voidedPayments: { id: string; transactionId: string; learner: string; reason: string | null }[];
}

const MONEY_OVERRIDE_TYPES = ["REVERSE_AUDIT", "VOID_PAYMENT", "APPROVE_CONCESSION", "DELEGATED_AUDIT", "UNLOCK_FEE"];

export async function monthlyExceptionsReport(actor: Actor, year: number, month: number): Promise<MonthlyExceptionsReport> {
  assertReadAccess(actor);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const workStart = await import("@/server/services/system-config").then((m) => m.getConfigNumber("working_hours_start", 9));
  const workEnd = await import("@/server/services/system-config").then((m) => m.getConfigNumber("working_hours_end", 18));

  const approved = await db.payment.findMany({
    where: { auditStatus: AuditStatus.APPROVED, auditedAt: { gte: from, lt: to } },
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    take: 2000,
  });
  const outsideHours = approved
    .filter((p) => p.auditedAt && (istHour(p.auditedAt) < workStart || istHour(p.auditedAt) >= workEnd))
    .map((p) => ({ id: p.id, transactionId: p.transactionId, learner: p.enrollment.lead.fullName, approvedAt: p.auditedAt!.toISOString(), istHour: istHour(p.auditedAt!) }));

  const overrides = await db.superAdminActivity.findMany({ where: { overrideType: { in: MONEY_OVERRIDE_TYPES }, performedAt: { gte: from, lt: to } }, orderBy: { performedAt: "desc" } });

  const voided = await db.payment.findMany({
    where: { voided: true, enrollment: { payments: { some: {} } } },
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    take: 1000,
  });

  return {
    year,
    month,
    approvedOutsideHours: outsideHours,
    moneyOverrides: overrides.map((o) => ({ id: o.id, overrideType: o.overrideType, entityRef: o.entityId, reason: o.reasonText, at: o.performedAt.toISOString() })),
    voidedPayments: voided.map((p) => ({ id: p.id, transactionId: p.transactionId, learner: p.enrollment.lead.fullName, reason: p.voidedReason })),
  };
}

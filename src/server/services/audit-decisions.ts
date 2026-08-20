/**
 * Level-1 audit decisions (FR-DM-14..23, FR-REC-02..04/09, BR-15/16/27). Nandhiya's
 * approval gate — the core control the platform exists to enforce. Auditing is at the
 * PAYMENT level, not the lead level (FRD 3.2 rule 2). Approval is heavily gated; only
 * APPROVED publishes to Finance (via the single predicate in finance-visibility).
 */
import "server-only";
import { AuditStatus, PaymentType, Role, type Prisma } from "@prisma/client";
import { db, type DbTx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { advanceLeadStatus } from "@/server/services/leads";
import { getConfigNumber } from "@/server/services/system-config";
import { notifyUser } from "@/server/notifications";
import { money, round, sum, eq, gt, sub, formatINR } from "@/server/money";

export class AuditError extends Error {
  readonly code = "AUDIT_ERROR";
}

const OPEN_STATUSES: AuditStatus[] = [AuditStatus.PENDING_AUDIT, AuditStatus.RESUBMITTED];

type PaymentWithContext = Prisma.PaymentGetPayload<{
  include: { proofs: true; enrollment: { include: { lead: { include: { salesperson: true } } } } };
}>;

async function loadPayment(paymentId: string): Promise<PaymentWithContext> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { proofs: { orderBy: { version: "desc" } }, enrollment: { include: { lead: { include: { salesperson: true } } } } },
  });
  if (!payment) throw new AuditError("Payment not found.");
  return payment;
}

/** Approved (non-voided) received on an enrollment, optionally excluding one payment. */
async function approvedReceived(enrollmentId: string, excludePaymentId?: string) {
  const payments = await db.payment.findMany({
    where: { enrollmentId, auditStatus: AuditStatus.APPROVED, voided: false, ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) },
    select: { receivedAmount: true },
  });
  return round(sum(payments.map((p) => p.receivedAmount.toString())));
}

// ── Approval (FR-REC-02, BR-27, FR-DM-22, FR-REC-03/04) ───────────────────────

export interface ApprovalConfirmations {
  amountMatches: boolean;
  dateMatches: boolean;
  transactionIdMatches: boolean;
}

export interface ApproveInput {
  confirmations: ApprovalConfirmations;
  /** Required when received differs from expected (FR-REC-03). */
  varianceReason?: string;
}

/**
 * The full approval gate (FR-DM-22, FR-REC-02/03/04, BR-27), shared by Nandhiya's normal
 * approval AND the Super Admin's delegated audit (FR-SA-13) so the checks can never
 * diverge. Reads only — throws AuditError on any gate failure; returns whether the
 * payment carries an accepted variance.
 */
export async function assertPaymentApprovable(payment: PaymentWithContext, input: ApproveInput): Promise<{ variance: boolean }> {
  if (!OPEN_STATUSES.includes(payment.auditStatus)) {
    throw new AuditError("This payment is not awaiting audit.");
  }
  // Approval blocked if proof missing or Transaction ID blank (FR-DM-22).
  if (payment.proofs.length === 0) throw new AuditError("Approval is blocked: the payment proof is missing.");
  if (!payment.transactionId?.trim()) throw new AuditError("Approval is blocked: the Transaction ID is blank.");

  // Three SEPARATE match confirmations, recorded individually (FR-REC-02, BR-27).
  const c = input.confirmations;
  if (!c.amountMatches || !c.dateMatches || !c.transactionIdMatches) {
    throw new AuditError("You must confirm that the amount, the date and the Transaction ID each match the proof before approving.");
  }

  // Variance: block until the difference is accepted with a written reason (FR-REC-03).
  const variance = !eq(payment.expectedAmount.toString(), payment.receivedAmount.toString());
  if (variance && !input.varianceReason?.trim()) {
    throw new AuditError("The received amount differs from the expected amount — accept it with a written reason to approve.");
  }

  // Over-collection: block if this would exceed the final approved fee (FR-REC-04).
  //
  // There is deliberately NO override for this — the Super Admin's delegated-audit path runs
  // this very guard — so the message must name remedies that actually exist. It previously
  // said "Over-collection needs a Super Admin override", sending the auditor to someone
  // equally unable to approve it and leaving the record stuck with no way forward.
  const finalFee = payment.enrollment.finalApprovedFee;
  if (finalFee) {
    const others = await approvedReceived(payment.enrollmentId, payment.id);
    const newTotal = round(money(others).plus(payment.receivedAmount));
    if (gt(newTotal, finalFee)) {
      throw new AuditError(
        `Approving this would take the total approved received to ${formatINR(newTotal)}, above the Final Approved Fee of ${formatINR(finalFee)}. ` +
          "If the course or fee is wrong, ask a Sales Manager or the Super Admin to unlock the fee so Sales can correct it, then approve. " +
          "If the amount itself is wrong, send this payment back for correction instead.",
      );
    }
  }
  return { variance };
}

/**
 * Write an approval INSIDE the caller's transaction. `delegated=true` stamps the record
 * "Audited by Super Admin (delegated)" (FR-SA-13). Shared by approvePayment and the
 * Super Admin delegated-audit override so there is one approval implementation.
 */
export async function writeApproval(
  tx: DbTx,
  actor: Actor,
  payment: PaymentWithContext,
  variance: boolean,
  input: ApproveInput,
  delegated: boolean,
): Promise<void> {
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      auditStatus: AuditStatus.APPROVED,
      auditedBy: actor.userId,
      auditedAt: new Date(),
      locked: true, // immutable once approved (FR-REC-09)
      delegatedAudit: delegated,
      auditComment: variance ? input.varianceReason!.trim() : null,
      varianceReason: variance ? input.varianceReason!.trim() : payment.varianceReason,
    },
  });
  await writeAudit(tx, {
    entityType: "Payment",
    entityId: payment.id,
    action: delegated ? "AUDIT_APPROVE_DELEGATED" : "AUDIT_APPROVE",
    changes: [
      { field: "confirm_amount_matches", oldValue: null, newValue: true },
      { field: "confirm_date_matches", oldValue: null, newValue: true },
      { field: "confirm_transaction_id_matches", oldValue: null, newValue: true },
      { field: "auditStatus", oldValue: payment.auditStatus, newValue: AuditStatus.APPROVED },
      ...(delegated ? [{ field: "delegatedAudit", oldValue: false, newValue: true }] : []),
      ...(variance ? [{ field: "variance_accepted", oldValue: null, newValue: input.varianceReason!.trim() }] : []),
    ],
    actor,
  });
  await advanceLeadStatus(tx, payment.enrollment.leadId, actor);
}

/** Load a payment with its full context — exposed for the delegated-audit override. */
export function loadPaymentWithContext(paymentId: string): Promise<PaymentWithContext> {
  return loadPayment(paymentId);
}

export async function approvePayment(actor: Actor, paymentId: string, input: ApproveInput): Promise<void> {
  requirePermission(actor, "payment:audit"); // DATA_MGMT_AUDITOR only
  const payment = await loadPayment(paymentId);
  const { variance } = await assertPaymentApprovable(payment, input);
  await db.$transaction(async (tx) => {
    await writeApproval(tx, actor, payment, variance, input, false);
  });
  await notifyApprovalToSales(payment);
}

/**
 * Tell the salesperson who submitted it that their payment cleared audit.
 *
 * Correction and rejection already reached them; approval — the outcome they are actually
 * waiting on — did not, so a salesperson had to keep opening the lead to find out. Sent
 * after the transaction commits: a failed email must never roll back an approval.
 */
export async function notifyApprovalToSales(payment: PaymentWithContext): Promise<void> {
  await notifyUser({
    recipientId: payment.submittedBy,
    type: "PAYMENT_APPROVED",
    subject: `Payment approved — ${payment.enrollment.lead.fullName}`,
    body:
      `Payment #${payment.paymentNumber} for ${payment.enrollment.lead.fullName} ` +
      "has been approved by Data Management.",
    relatedEntityType: "Payment",
    relatedEntityId: payment.id,
  });
}

// ── Correction / Rejection (FR-DM-16/18, BR-16, FRD 3.2 rule 4) ───────────────

async function decideWithReason(
  actor: Actor,
  paymentId: string,
  status: AuditStatus,
  input: { reasonCode?: string; comment: string },
): Promise<void> {
  requirePermission(actor, "payment:audit");
  const payment = await loadPayment(paymentId);
  if (!OPEN_STATUSES.includes(payment.auditStatus)) throw new AuditError("This payment is not awaiting audit.");
  if (!input.comment?.trim()) throw new AuditError("A reason is required for this decision.");

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        auditStatus: status,
        auditedBy: actor.userId,
        auditedAt: new Date(),
        auditReasonCode: input.reasonCode?.trim() || null,
        auditComment: input.comment.trim(),
      },
    });
    await writeAudit(tx, {
      entityType: "Payment",
      entityId: paymentId,
      action: status === AuditStatus.CORRECTION_REQUIRED ? "AUDIT_CORRECTION" : "AUDIT_REJECT",
      changes: [
        { field: "auditStatus", oldValue: payment.auditStatus, newValue: status },
        { field: "reasonCode", oldValue: null, newValue: input.reasonCode ?? null },
        { field: "comment", oldValue: null, newValue: input.comment.trim() },
      ],
      actor,
    });
    await advanceLeadStatus(tx, payment.enrollment.leadId, actor);
  });

  // Correction routes back to the ORIGINATING salesperson only (FR-DM-18, FR-SAL-64, rule 4).
  if (status === AuditStatus.CORRECTION_REQUIRED) {
    await notifyUser({
      recipientId: payment.submittedBy,
      type: "PAYMENT_CORRECTION",
      subject: `Payment correction required — ${payment.enrollment.lead.fullName}`,
      body: `Payment #${payment.paymentNumber} needs correction: ${input.comment.trim()}`,
      relatedEntityType: "Payment",
      relatedEntityId: paymentId,
    });
  }

  // Rejection reaches the originating salesperson AND the Sales Manager (FR-SAL-65).
  if (status === AuditStatus.REJECTED) {
    const managers = await db.user.findMany({ where: { role: Role.SALES_MANAGER, status: "ACTIVE" }, select: { id: true, email: true } });
    const body = `Payment #${payment.paymentNumber} for ${payment.enrollment.lead.fullName} was rejected: ${input.comment.trim()}`;
    for (const recipient of [{ id: payment.submittedBy, email: undefined as string | undefined }, ...managers]) {
      await notifyUser({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        type: "PAYMENT_REJECTED",
        subject: `Payment rejected — ${payment.enrollment.lead.fullName}`,
        body,
        relatedEntityType: "Payment",
        relatedEntityId: paymentId,
      });
    }
  }
}

export function requestCorrection(actor: Actor, paymentId: string, input: { reasonCode?: string; comment: string }) {
  return decideWithReason(actor, paymentId, AuditStatus.CORRECTION_REQUIRED, input);
}
export function rejectPayment(actor: Actor, paymentId: string, input: { reasonCode?: string; comment: string }) {
  return decideWithReason(actor, paymentId, AuditStatus.REJECTED, input);
}

// ── Bulk approve clean records (FR-DM-21) ─────────────────────────────────────

export async function bulkApprove(actor: Actor, paymentIds: string[]): Promise<{ approved: string[]; skipped: { id: string; reason: string }[] }> {
  requirePermission(actor, "payment:audit");
  const approved: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of paymentIds) {
    try {
      const p = await loadPayment(id);
      const variance = !eq(p.expectedAmount.toString(), p.receivedAmount.toString());
      if (variance) { skipped.push({ id, reason: "amount differs from expected — audit individually" }); continue; }
      // Clean record: proof + txn present, no variance, no over-collection. Approve with
      // the three confirmations recorded (the bulk action asserts they match).
      await approvePayment(actor, id, { confirmations: { amountMatches: true, dateMatches: true, transactionIdMatches: true } });
      approved.push(id);
    } catch (e) {
      skipped.push({ id, reason: e instanceof AuditError ? e.message : "could not be approved" });
    }
  }
  return { approved, skipped };
}

// ── Salesperson correction → resubmit (FR-DM-19, FRD 3.2 rule 4) ──────────────

export async function correctAndResubmit(
  actor: Actor,
  paymentId: string,
  changes: { receivedAmount?: string; paymentDate?: string; transactionId?: string },
): Promise<void> {
  const payment = await loadPayment(paymentId);
  const { requireRecordAccess } = await import("@/server/auth/permissions");
  requireRecordAccess(actor, payment.enrollment.lead);
  if (payment.auditStatus !== AuditStatus.CORRECTION_REQUIRED) {
    throw new AuditError("This payment is not awaiting correction.");
  }

  const diff: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  const data: Prisma.PaymentUpdateInput = { auditStatus: AuditStatus.RESUBMITTED, submittedAt: new Date() };
  if (changes.receivedAmount != null && !eq(changes.receivedAmount, payment.receivedAmount.toString())) {
    diff.push({ field: "receivedAmount", oldValue: payment.receivedAmount.toString(), newValue: changes.receivedAmount });
    data.receivedAmount = round(changes.receivedAmount).toFixed(2);
  }
  if (changes.paymentDate != null) {
    diff.push({ field: "paymentDate", oldValue: payment.paymentDate.toISOString(), newValue: changes.paymentDate });
    data.paymentDate = new Date(changes.paymentDate);
  }
  if (changes.transactionId != null && changes.transactionId.trim() !== payment.transactionId) {
    diff.push({ field: "transactionId", oldValue: payment.transactionId, newValue: changes.transactionId.trim() });
    data.transactionId = changes.transactionId.trim();
  }

  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data });
    await writeAudit(tx, {
      entityType: "Payment",
      entityId: paymentId,
      action: "PAYMENT_RESUBMIT",
      changes: [...diff, { field: "auditStatus", oldValue: payment.auditStatus, newValue: AuditStatus.RESUBMITTED }],
      actor,
    });
    await advanceLeadStatus(tx, payment.enrollment.leadId, actor);
  });
}

// ── Queue, record view, tiles, timeline ───────────────────────────────────────

export interface AuditFilters {
  status?: AuditStatus;
  paymentType?: PaymentType;
  salespersonId?: string;
  search?: string;
}

function buildWhere(filters: AuditFilters): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = { voided: false };
  if (filters.status) where.auditStatus = filters.status;
  if (filters.paymentType) where.paymentType = filters.paymentType;
  if (filters.salespersonId) where.enrollment = { lead: { salespersonId: filters.salespersonId } };
  if (filters.search) {
    where.OR = [
      { transactionId: { contains: filters.search, mode: "insensitive" } },
      { enrollment: { lead: { fullName: { contains: filters.search, mode: "insensitive" } } } },
      { enrollment: { lead: { mobile: { contains: filters.search } } } },
      { enrollment: { lead: { email: { contains: filters.search, mode: "insensitive" } } } },
    ];
  }
  return where;
}

export async function auditQueue(actor: Actor, filters: AuditFilters = {}) {
  requirePermission(actor, "payment:audit");
  const rows = await db.payment.findMany({
    where: buildWhere(filters),
    include: { proofs: { orderBy: { version: "desc" }, take: 1 }, enrollment: { include: { lead: { include: { salesperson: { select: { name: true } } } } } } },
    // Resubmitted first, then oldest submissions to the top (FR-DM-19).
    orderBy: [{ auditStatus: "asc" }, { submittedAt: "desc" }],
    take: 300,
  });
  return rows.map((p) => ({
    id: p.id,
    leadName: p.enrollment.lead.fullName,
    mobile: p.enrollment.lead.mobile,
    email: p.enrollment.lead.email,
    ownerName: p.enrollment.lead.salesperson.name,
    program: p.enrollment.program,
    plan: p.enrollment.plan,
    paymentNumber: p.paymentNumber,
    paymentType: p.paymentType,
    expectedAmount: p.expectedAmount.toFixed(2),
    receivedAmount: p.receivedAmount.toFixed(2),
    paymentDate: p.paymentDate.toISOString(),
    paymentMethod: p.paymentMethod,
    transactionId: p.transactionId,
    auditStatus: p.auditStatus,
    submittedAt: p.submittedAt.toISOString(),
    manualEntryNoOcr: p.manualEntryNoOcr,
    delegatedAudit: p.delegatedAudit,
    hasVariance: !eq(p.expectedAmount.toString(), p.receivedAmount.toString()),
    proofId: p.proofs[0]?.id ?? null,
  }));
}

export async function getAuditRecord(actor: Actor, paymentId: string) {
  requirePermission(actor, "payment:audit");
  const p = await loadPayment(paymentId);
  const others = await approvedReceived(p.enrollmentId, p.id);
  const finalFee = p.enrollment.finalApprovedFee?.toString() ?? "0";
  const allApproved = await approvedReceived(p.enrollmentId);
  const balance = round(sub(finalFee, allApproved));

  const windowHours = await getConfigNumber("duplicate_payment_window_hours", 24);
  const since = new Date(p.paymentDate.getTime() - windowHours * 3600_000);
  const until = new Date(p.paymentDate.getTime() + windowHours * 3600_000);
  const dupCount = await db.payment.count({
    where: {
      id: { not: p.id }, voided: false, enrollmentId: p.enrollmentId,
      receivedAmount: p.receivedAmount, paymentDate: { gte: since, lte: until },
    },
  });

  return {
    id: p.id,
    leadId: p.enrollment.leadId,
    leadName: p.enrollment.lead.fullName,
    mobile: p.enrollment.lead.mobile,
    email: p.enrollment.lead.email,
    ownerName: p.enrollment.lead.salesperson.name,
    program: p.enrollment.program,
    plan: p.enrollment.plan,
    paymentNumber: p.paymentNumber,
    paymentType: p.paymentType,
    expectedAmount: p.expectedAmount.toFixed(2),
    receivedAmount: p.receivedAmount.toFixed(2),
    paymentDate: p.paymentDate.toISOString(),
    paymentMethod: p.paymentMethod,
    transactionId: p.transactionId,
    auditStatus: p.auditStatus,
    auditComment: p.auditComment,
    manualEntryNoOcr: p.manualEntryNoOcr,
    delegatedAudit: p.delegatedAudit,
    varianceReason: p.varianceReason,
    hasVariance: !eq(p.expectedAmount.toString(), p.receivedAmount.toString()),
    finalApprovedFee: p.enrollment.finalApprovedFee?.toFixed(2) ?? null,
    totalReceivedToDate: allApproved.toFixed(2),
    balance: balance.toFixed(2),
    wouldExceedFee: gt(round(money(others).plus(p.receivedAmount)), finalFee),
    probableDuplicate: dupCount > 0,
    proofId: p.proofs[0]?.id ?? null,
    proofVersions: p.proofs.length,
  };
}

/** Reverse-chronological, immutable audit timeline for a payment (FR-DM-30..45). */
export async function auditTimeline(actor: Actor, paymentId: string) {
  requirePermission(actor, "audit:read:all");
  const entries = await db.auditTrail.findMany({
    where: { entityType: "Payment", entityId: paymentId },
    orderBy: { performedAt: "desc" },
  });
  const actorIds = [...new Set(entries.map((e) => e.performedBy))];
  const users = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return entries.map((e) => ({
    id: e.id,
    action: e.action,
    field: e.fieldName,
    oldValue: e.oldValue,
    newValue: e.newValue,
    byName: nameOf.get(e.performedBy) ?? "System",
    role: e.performedByRole,
    at: e.performedAt.toISOString(),
  }));
}

export interface DashboardTile {
  key: string;
  label: string;
  count: number;
  total: string;
}

export async function auditDashboard(actor: Actor): Promise<{ tiles: DashboardTile[]; ageing: { amber: number; red: number } }> {
  requirePermission(actor, "payment:audit");
  const statuses: [string, AuditStatus][] = [
    ["pending", AuditStatus.PENDING_AUDIT],
    ["approved", AuditStatus.APPROVED],
    ["correction", AuditStatus.CORRECTION_REQUIRED],
    ["rejected", AuditStatus.REJECTED],
    ["resubmitted", AuditStatus.RESUBMITTED],
  ];
  const tiles: DashboardTile[] = [];
  for (const [key, status] of statuses) {
    const rows = await db.payment.findMany({ where: { auditStatus: status, voided: false }, select: { receivedAmount: true } });
    tiles.push({ key, label: status, count: rows.length, total: round(sum(rows.map((r) => r.receivedAmount.toString()))).toFixed(2) });
  }

  const ageHours = await getConfigNumber("audit_ageing_threshold_hours", 48);
  const amberAt = new Date(Date.now() - ageHours * 3600_000);
  const redAt = new Date(Date.now() - 2 * ageHours * 3600_000);
  const [amber, red] = await Promise.all([
    db.payment.count({ where: { auditStatus: { in: OPEN_STATUSES }, voided: false, submittedAt: { lt: amberAt } } }),
    db.payment.count({ where: { auditStatus: { in: OPEN_STATUSES }, voided: false, submittedAt: { lt: redAt } } }),
  ]);
  return { tiles, ageing: { amber, red } };
}

/** CSV of the current queue with filters intact (FR-DM-12/13). */
export async function auditQueueCsv(actor: Actor, filters: AuditFilters = {}): Promise<string> {
  const rows = await auditQueue(actor, filters);
  const header = ["Lead", "Owner", "Program", "Plan", "Type", "Expected", "Received", "Date", "Method", "TxnID", "Status"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.leadName, r.ownerName, r.program, r.plan, r.paymentType, r.expectedAmount, r.receivedAmount, r.paymentDate.slice(0, 10), r.paymentMethod, r.transactionId, r.auditStatus]
      .map((v) => escape(String(v ?? "")))
      .join(","),
  );
  return [header.map(escape).join(","), ...lines].join("\n");
}

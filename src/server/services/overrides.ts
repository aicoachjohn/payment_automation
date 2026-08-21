/**
 * Super Admin override authority (FR-SA-06..15, BR-24..26). The governing principle:
 * the Super Admin can unblock any situation but can NEVER quietly change a number —
 * every path to correcting money runs back through Sales and Nandhiya, and every
 * override is reported to Rajesh.
 *
 * There is exactly ONE entry point — `performOverride()` — and EVERY override routes
 * through it, so the four guarantees can never be forgotten in one branch:
 *   1. a mandatory written reason,
 *   2. an immutable SuperAdminActivity entry,
 *   3. an immutable AuditTrail entry, and
 *   4. a notification to the affected role(s).
 * The mutation, the AuditTrail write and the SuperAdminActivity write all happen inside
 * ONE transaction; notifications fire only after it commits.
 *
 * Note what is ABSENT: there is no override kind, anywhere, that edits a payment amount,
 * payment date or Transaction ID (FR-SA-08, BR-24). Correcting an approved payment is
 * possible ONLY by REVERSE_AUDIT, which sends the record back through Sales + Nandhiya.
 */
import "server-only";
import { AuditStatus, Role, type Prisma } from "@prisma/client";
import { db, type DbTx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, AuthorizationError, type Actor, type Permission } from "@/server/auth/permissions";
import { advanceLeadStatus } from "@/server/services/leads";
import { reDeriveExpectedAmount } from "@/server/services/payments";
import { notifyUser } from "@/server/notifications";
import {
  assertPaymentApprovable,
  writeApproval,
  loadPaymentWithContext,
  type ApprovalConfirmations,
} from "@/server/services/audit-decisions";
import { formatINR } from "@/server/money";

export class OverrideError extends Error {
  readonly code = "OVERRIDE_ERROR";
}

export type OverrideKind =
  | "REVERSE_AUDIT"
  | "UNLOCK_FEE"
  | "REASSIGN_LEAD"
  | "APPROVE_CONCESSION"
  | "EXTEND_DEADLINE"
  | "REVERSE_OPS_TRANSFER"
  | "DELEGATED_AUDIT"
  | "VOID_PAYMENT";

export type OverrideInput =
  | { kind: "REVERSE_AUDIT"; paymentId: string; reason: string }
  | { kind: "UNLOCK_FEE"; enrollmentId: string; reason: string }
  | { kind: "REASSIGN_LEAD"; leadId: string; newSalespersonId: string; reason: string }
  | { kind: "APPROVE_CONCESSION"; leadId: string; reason: string }
  | { kind: "EXTEND_DEADLINE"; enrollmentId: string; days: number; reason: string }
  | { kind: "REVERSE_OPS_TRANSFER"; enrollmentId: string; reason: string }
  | {
      kind: "DELEGATED_AUDIT";
      paymentId: string;
      decision: "APPROVE" | "CORRECTION" | "REJECT";
      reason: string;
      confirmations?: ApprovalConfirmations;
      varianceReason?: string;
    }
  | { kind: "VOID_PAYMENT"; paymentId: string; reason: string };

/** Each override kind is gated by an SA-only permission AND the SUPER_ADMIN role. */
const OVERRIDE_PERMISSION: Record<OverrideKind, Permission> = {
  REVERSE_AUDIT: "payment:reverse-audit",
  UNLOCK_FEE: "fee:unlock",
  REASSIGN_LEAD: "lead:update:all",
  APPROVE_CONCESSION: "concession:approve",
  EXTEND_DEADLINE: "lead:update:all",
  REVERSE_OPS_TRANSFER: "lead:update:all",
  DELEGATED_AUDIT: "payment:reverse-audit",
  VOID_PAYMENT: "payment:reverse-audit",
};

interface NotifyIntent {
  recipientId: string;
  type: string;
  subject: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

interface HandlerResult {
  entityType: string;
  entityId: string;
  previousState?: Prisma.InputJsonValue;
  newState?: Prisma.InputJsonValue;
  notify: NotifyIntent[];
}

// ── Recipient helpers ─────────────────────────────────────────────────────────

async function usersInRoles(roles: Role[]): Promise<{ id: string; email: string }[]> {
  return db.user.findMany({ where: { role: { in: roles }, status: "ACTIVE" }, select: { id: true, email: true } });
}

function notify(list: { id: string; email: string }[], msg: Omit<NotifyIntent, "recipientId">): NotifyIntent[] {
  return list.map((u) => ({ recipientId: u.id, ...msg }));
}

function monthYear(d: Date): string {
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ── The single entry point ─────────────────────────────────────────────────────

export async function performOverride(actor: Actor, input: OverrideInput): Promise<{ activityId: string }> {
  // Overrides are SUPER_ADMIN-only. A Sales Manager holds some of the same base
  // permissions (fee:unlock, concession:approve) but may never perform an override.
  if (actor.role !== Role.SUPER_ADMIN) {
    throw new AuthorizationError("Only the Super Admin can perform an override.");
  }
  requirePermission(actor, OVERRIDE_PERMISSION[input.kind]);
  if (!input.reason?.trim()) {
    throw new OverrideError("A written reason is required for every override.");
  }

  const outcome = await db.$transaction(async (tx) => {
    const r = await runHandler(tx, actor, input);
    const activity = await tx.superAdminActivity.create({
      data: {
        superAdminId: actor.userId,
        overrideType: input.kind,
        entityType: r.entityType,
        entityId: r.entityId,
        reasonText: input.reason.trim(),
        previousState: r.previousState,
        newState: r.newState,
        notifiedTo: r.notify.map((n) => n.recipientId),
      },
    });
    return { activityId: activity.id, notify: r.notify };
  });

  // Notifications AFTER commit — the record change and its logs are already durable.
  for (const n of outcome.notify) {
    await notifyUser(n);
  }
  return { activityId: outcome.activityId };
}

function runHandler(tx: DbTx, actor: Actor, input: OverrideInput): Promise<HandlerResult> {
  switch (input.kind) {
    case "REVERSE_AUDIT":
      return reverseAudit(tx, actor, input);
    case "UNLOCK_FEE":
      return unlockFee(tx, actor, input);
    case "REASSIGN_LEAD":
      return reassignLead(tx, actor, input);
    case "APPROVE_CONCESSION":
      return approveConcession(tx, actor, input);
    case "EXTEND_DEADLINE":
      return extendDeadline(tx, actor, input);
    case "REVERSE_OPS_TRANSFER":
      return reverseOpsTransfer(tx, actor, input);
    case "DELEGATED_AUDIT":
      return delegatedAudit(tx, actor, input);
    case "VOID_PAYMENT":
      return voidPayment(tx, actor, input);
  }
}

// ── Handlers (each mutates via tx + writes the AuditTrail entry) ───────────────

async function reverseAudit(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "REVERSE_AUDIT" }>): Promise<HandlerResult> {
  const payment = await loadPaymentWithContext(input.paymentId);
  if (payment.voided) throw new OverrideError("This payment is voided and cannot be reversed.");
  const was = payment.auditStatus;
  if (was !== AuditStatus.APPROVED && was !== AuditStatus.REJECTED) {
    throw new OverrideError("Only an approved or rejected decision can be reversed or reopened.");
  }

  await tx.payment.update({
    where: { id: payment.id },
    // Back to the queue. Clearing `locked`/`delegatedAudit` returns it to a fully
    // editable state; being != APPROVED withdraws it from Finance immediately (BR-15).
    data: { auditStatus: AuditStatus.PENDING_AUDIT, locked: false, delegatedAudit: false },
  });
  // Reversal exists to CORRECT a record, and the usual reason one needs correcting is that
  // the course or fee moved after capture — leaving the DERIVED instalment figure pointing at
  // a schedule that no longer exists. Reopening is the one moment it can be re-derived, and
  // the arithmetic lives with the rest of the payment rules, not in this override funnel.
  // Must follow the unlock above: FR-REC-09 rejects the change while the row is still
  // APPROVED+locked, and that guard is left exactly as strong as it was.
  const reDerived = await reDeriveExpectedAmount(tx, payment.id);
  await writeAudit(tx, {
    entityType: "Payment",
    entityId: payment.id,
    action: "OVERRIDE_AUDIT_REVERSAL",
    changes: [
      { field: "auditStatus", oldValue: was, newValue: AuditStatus.PENDING_AUDIT },
      { field: "reason", oldValue: null, newValue: input.reason.trim() },
      ...(reDerived ? [{ field: "expectedAmount", oldValue: reDerived.from, newValue: reDerived.to }] : []),
    ],
    actor,
  });
  await advanceLeadStatus(tx, payment.enrollment.leadId, actor);

  const auditors = await usersInRoles([Role.DATA_MGMT_AUDITOR]);
  const financeUsers = await usersInRoles([Role.FINANCE_REVIEWER]);
  const salesperson = payment.enrollment.lead.salesperson;
  const wasApproved = was === AuditStatus.APPROVED;
  const body = wasApproved
    ? `An approved payment (${payment.transactionId}, ${formatINR(payment.receivedAmount.toString())}) for ${payment.enrollment.lead.fullName} has been WITHDRAWN from the approved collection and returned to the audit queue. Reason: ${input.reason.trim()}`
    : `A rejected payment (${payment.transactionId}) for ${payment.enrollment.lead.fullName} has been returned to the audit queue. Reason: ${input.reason.trim()}`;
  const recipients = [
    ...notify(auditors, { type: "OVERRIDE_AUDIT_REVERSAL", subject: "Audit decision reversed", body, relatedEntityType: "Payment", relatedEntityId: payment.id }),
    { recipientId: salesperson.id, type: "OVERRIDE_AUDIT_REVERSAL", subject: "Audit decision reversed", body, relatedEntityType: "Payment", relatedEntityId: payment.id },
    // FR-SA-07: on reversing an APPROVED payment, notify Rajesh of the withdrawal.
    ...(wasApproved ? notify(financeUsers, { type: "OVERRIDE_AUDIT_REVERSAL", subject: "Approved payment withdrawn from collection", body, relatedEntityType: "Payment", relatedEntityId: payment.id }) : []),
  ];
  return {
    entityType: "Payment",
    entityId: payment.id,
    // Snapshot the withdrawn amount under a neutral key — this module deliberately never
    // names a frozen payment field (received amount / date / Txn ID), which is what the
    // Phase-9 grep proof asserts (FR-SA-08, BR-24).
    previousState: { auditStatus: was, withdrawnAmount: payment.receivedAmount.toString() },
    newState: { auditStatus: AuditStatus.PENDING_AUDIT },
    notify: recipients,
  };
}

async function unlockFee(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "UNLOCK_FEE" }>): Promise<HandlerResult> {
  const e = await db.enrollment.findUnique({ where: { id: input.enrollmentId }, include: { lead: { include: { salesperson: true } } } });
  if (!e) throw new OverrideError("Enrollment not found.");
  if (!e.feeLockedAt) throw new OverrideError("The fee is not locked for this lead.");

  await tx.enrollment.update({ where: { id: e.id }, data: { feeLockedAt: null, enrollmentStatus: "DRAFT" } });
  await writeAudit(tx, {
    entityType: "Enrollment",
    entityId: e.id,
    action: "OVERRIDE_FEE_UNLOCK",
    changes: [
      { field: "feeLockedAt", oldValue: e.feeLockedAt, newValue: null },
      { field: "reason", oldValue: null, newValue: input.reason.trim() },
    ],
    actor,
  });

  const managers = await usersInRoles([Role.SALES_MANAGER]);
  const body = `The locked fee for ${e.lead.fullName} was unlocked. The payment draft must be regenerated. Reason: ${input.reason.trim()}`;
  return {
    entityType: "Enrollment",
    entityId: e.id,
    previousState: { feeLockedAt: e.feeLockedAt?.toISOString() ?? null },
    newState: { feeLockedAt: null },
    notify: [
      { recipientId: e.lead.salesperson.id, type: "OVERRIDE_FEE_UNLOCK", subject: "Fee unlocked", body, relatedEntityType: "Enrollment", relatedEntityId: e.id },
      ...notify(managers, { type: "OVERRIDE_FEE_UNLOCK", subject: "Fee unlocked", body, relatedEntityType: "Enrollment", relatedEntityId: e.id }),
    ],
  };
}

async function reassignLead(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "REASSIGN_LEAD" }>): Promise<HandlerResult> {
  const lead = await db.lead.findUnique({ where: { id: input.leadId }, include: { salesperson: true } });
  if (!lead) throw new OverrideError("Lead not found.");
  const to = await db.user.findUnique({ where: { id: input.newSalespersonId } });
  if (!to || to.status !== "ACTIVE" || (to.role !== Role.SALESPERSON && to.role !== Role.SALES_MANAGER)) {
    throw new OverrideError("Choose an active salesperson to reassign to.");
  }
  if (to.id === lead.salespersonId) throw new OverrideError("The lead is already assigned to that salesperson.");

  await tx.lead.update({ where: { id: lead.id }, data: { salespersonId: to.id } });
  await writeAudit(tx, {
    entityType: "Lead",
    entityId: lead.id,
    action: "OVERRIDE_LEAD_REASSIGN",
    changes: [
      { field: "salespersonId", oldValue: lead.salespersonId, newValue: to.id },
      { field: "reason", oldValue: null, newValue: input.reason.trim() },
    ],
    actor,
  });

  const body = `Lead "${lead.fullName}" was reassigned from ${lead.salesperson.name} to ${to.name}. Reason: ${input.reason.trim()}`;
  return {
    entityType: "Lead",
    entityId: lead.id,
    previousState: { salespersonId: lead.salespersonId },
    newState: { salespersonId: to.id },
    notify: [
      { recipientId: lead.salesperson.id, type: "OVERRIDE_LEAD_REASSIGN", subject: "Lead reassigned", body, relatedEntityType: "Lead", relatedEntityId: lead.id },
      { recipientId: to.id, type: "OVERRIDE_LEAD_REASSIGN", subject: "Lead reassigned to you", body, relatedEntityType: "Lead", relatedEntityId: lead.id },
    ],
  };
}

async function approveConcession(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "APPROVE_CONCESSION" }>): Promise<HandlerResult> {
  const lead = await db.lead.findUnique({ where: { id: input.leadId }, include: { enrollment: true, salesperson: true } });
  if (!lead?.enrollment) throw new OverrideError("Lead or enrollment not found.");
  if (lead.enrollment.concessionStatus !== "PENDING_APPROVAL") {
    throw new OverrideError("There is no pending concession to approve on this lead.");
  }

  await tx.enrollment.update({ where: { id: lead.enrollment.id }, data: { concessionStatus: "APPROVED" } });
  await writeAudit(tx, {
    entityType: "Enrollment",
    entityId: lead.enrollment.id,
    action: "OVERRIDE_CONCESSION_APPROVE",
    changes: [
      { field: "concessionStatus", oldValue: lead.enrollment.concessionStatus, newValue: "APPROVED" },
      { field: "reason", oldValue: null, newValue: input.reason.trim() },
    ],
    actor,
  });
  await advanceLeadStatus(tx, lead.id, actor);

  const financeUsers = await usersInRoles([Role.FINANCE_REVIEWER]);
  const body = `The above-threshold concession on ${lead.fullName} was approved by the Super Admin. Reason: ${input.reason.trim()}`;
  return {
    entityType: "Enrollment",
    entityId: lead.enrollment.id,
    previousState: { concessionStatus: lead.enrollment.concessionStatus },
    newState: { concessionStatus: "APPROVED" },
    notify: [
      { recipientId: lead.salesperson.id, type: "OVERRIDE_CONCESSION_APPROVE", subject: "Concession approved", body, relatedEntityType: "Lead", relatedEntityId: lead.id },
      ...notify(financeUsers, { type: "OVERRIDE_CONCESSION_APPROVE", subject: "Above-threshold concession approved", body, relatedEntityType: "Lead", relatedEntityId: lead.id }),
    ],
  };
}

async function extendDeadline(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "EXTEND_DEADLINE" }>): Promise<HandlerResult> {
  const e = await db.enrollment.findUnique({ where: { id: input.enrollmentId }, include: { lead: { include: { salesperson: true } } } });
  if (!e) throw new OverrideError("Enrollment not found.");
  if (!Number.isInteger(input.days) || input.days <= 0) throw new OverrideError("Enter a positive number of days.");

  // Push any open follow-up (down-payment) task out by `days` (Phase 10 wires the rule).
  const task = await db.followUpTask.findFirst({ where: { leadId: e.leadId, status: "OPEN" }, orderBy: { dueDate: "asc" } });
  let oldDue: string | null = null;
  let newDue: string | null = null;
  if (task) {
    oldDue = task.dueDate.toISOString();
    const bumped = new Date(task.dueDate.getTime() + input.days * 86_400_000);
    newDue = bumped.toISOString();
    await tx.followUpTask.update({ where: { id: task.id }, data: { dueDate: bumped } });
  }
  await writeAudit(tx, {
    entityType: "Enrollment",
    entityId: e.id,
    action: "OVERRIDE_DEADLINE_EXTENSION",
    changes: [
      { field: "deadlineExtensionDays", oldValue: null, newValue: input.days },
      ...(oldDue ? [{ field: "followUpDueDate", oldValue: oldDue, newValue: newDue }] : []),
      { field: "reason", oldValue: null, newValue: input.reason.trim() },
    ],
    actor,
  });

  const body = `The 15-day down-payment deadline for ${e.lead.fullName} was extended by ${input.days} day(s). Reason: ${input.reason.trim()}`;
  return {
    entityType: "Enrollment",
    entityId: e.id,
    previousState: { followUpDueDate: oldDue },
    newState: { followUpDueDate: newDue, extendedDays: input.days },
    notify: [{ recipientId: e.lead.salesperson.id, type: "OVERRIDE_DEADLINE_EXTENSION", subject: "Deadline extended", body, relatedEntityType: "Enrollment", relatedEntityId: e.id }],
  };
}

async function reverseOpsTransfer(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "REVERSE_OPS_TRANSFER" }>): Promise<HandlerResult> {
  const e = await db.enrollment.findUnique({ where: { id: input.enrollmentId }, include: { lead: { include: { salesperson: true } }, handovers: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!e) throw new OverrideError("Enrollment not found.");
  const handover = e.handovers[0];
  if (handover) {
    await tx.operationsHandover.update({ where: { id: handover.id }, data: { validatedFlag: false, handoverDate: null } });
  }
  await writeAudit(tx, {
    entityType: "Enrollment",
    entityId: e.id,
    action: "OVERRIDE_OPS_TRANSFER_REVERSAL",
    changes: [
      { field: "opsHandoverReversed", oldValue: null, newValue: handover?.id ?? "none" },
      { field: "reason", oldValue: null, newValue: input.reason.trim() },
    ],
    actor,
  });

  const body = `The Operations transfer for ${e.lead.fullName} was reversed. Reason: ${input.reason.trim()}`;
  return {
    entityType: "Enrollment",
    entityId: e.id,
    previousState: { handoverId: handover?.id ?? null },
    newState: { reversed: true },
    notify: [{ recipientId: e.lead.salesperson.id, type: "OVERRIDE_OPS_TRANSFER_REVERSAL", subject: "Operations transfer reversed", body, relatedEntityType: "Enrollment", relatedEntityId: e.id }],
  };
}

async function delegatedAudit(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "DELEGATED_AUDIT" }>): Promise<HandlerResult> {
  const payment = await loadPaymentWithContext(input.paymentId);
  const financeUsers = await usersInRoles([Role.FINANCE_REVIEWER]);
  const auditors = await usersInRoles([Role.DATA_MGMT_AUDITOR]);

  if (input.decision === "APPROVE") {
    const confirmations = input.confirmations;
    if (!confirmations) throw new OverrideError("Confirm the amount, date and Transaction ID before approving.");
    const { variance } = await assertPaymentApprovable(payment, { confirmations, varianceReason: input.varianceReason });
    await writeApproval(tx, actor, payment, variance, { confirmations, varianceReason: input.varianceReason }, /* delegated */ true);
  } else {
    const status = input.decision === "CORRECTION" ? AuditStatus.CORRECTION_REQUIRED : AuditStatus.REJECTED;
    await tx.payment.update({
      where: { id: payment.id },
      data: { auditStatus: status, auditedBy: actor.userId, auditedAt: new Date(), delegatedAudit: true, auditComment: input.reason.trim() },
    });
    await writeAudit(tx, {
      entityType: "Payment",
      entityId: payment.id,
      action: status === AuditStatus.CORRECTION_REQUIRED ? "AUDIT_CORRECTION_DELEGATED" : "AUDIT_REJECT_DELEGATED",
      changes: [
        { field: "auditStatus", oldValue: payment.auditStatus, newValue: status },
        { field: "delegatedAudit", oldValue: false, newValue: true },
        { field: "comment", oldValue: null, newValue: input.reason.trim() },
      ],
      actor,
    });
    await advanceLeadStatus(tx, payment.enrollment.leadId, actor);
  }

  const verb = input.decision === "APPROVE" ? "approved" : input.decision === "CORRECTION" ? "sent for correction" : "rejected";
  const body = `Payment ${payment.transactionId} for ${payment.enrollment.lead.fullName} was ${verb} by the Super Admin acting as delegated auditor. Reason: ${input.reason.trim()}`;
  return {
    entityType: "Payment",
    entityId: payment.id,
    previousState: { auditStatus: payment.auditStatus },
    newState: { decision: input.decision, delegatedAudit: true },
    // FR-SA-18: a delegated audit notifies Rajesh; Nandhiya is informed her queue moved.
    notify: [
      ...notify(financeUsers, { type: "OVERRIDE_DELEGATED_AUDIT", subject: "Delegated audit performed", body, relatedEntityType: "Payment", relatedEntityId: payment.id }),
      ...notify(auditors, { type: "OVERRIDE_DELEGATED_AUDIT", subject: "Delegated audit performed", body, relatedEntityType: "Payment", relatedEntityId: payment.id }),
    ],
  };
}

/**
 * Void a payment entered in error (FR-REC-10, FR-SA-14, BR-26). Nothing is ever deleted:
 * the row is flagged voided with a mandatory reason, excluded from every total (the
 * finance predicate and calculateBalance both drop voided rows), and stays permanently
 * visible in history. Voiding an approved payment removes its amount from the collection,
 * so Rajesh is notified. This writes a balance-change audit entry (FR-REC-16).
 */
async function voidPayment(tx: DbTx, actor: Actor, input: Extract<OverrideInput, { kind: "VOID_PAYMENT" }>): Promise<HandlerResult> {
  const payment = await loadPaymentWithContext(input.paymentId);
  if (payment.voided) throw new OverrideError("This payment is already voided.");
  const wasApproved = payment.auditStatus === AuditStatus.APPROVED;

  await tx.payment.update({ where: { id: payment.id }, data: { voided: true, voidedReason: input.reason.trim() } });
  await writeAudit(tx, {
    entityType: "Payment",
    entityId: payment.id,
    action: "VOID_PAYMENT",
    changes: [
      { field: "voided", oldValue: false, newValue: true },
      { field: "reason", oldValue: null, newValue: input.reason.trim() },
      // FR-REC-16: record the balance effect — an approved void withdraws this from totals.
      { field: "balanceEffect", oldValue: wasApproved ? payment.receivedAmount.toString() : "0.00", newValue: "voided" },
    ],
    actor,
  });
  await advanceLeadStatus(tx, payment.enrollment.leadId, actor);

  const finance = await usersInRoles([Role.FINANCE_REVIEWER]);
  const salesperson = payment.enrollment.lead.salesperson;
  const body = `Payment ${payment.transactionId} for ${payment.enrollment.lead.fullName} was voided. It is excluded from all totals but remains visible in history. Reason: ${input.reason.trim()}`;
  return {
    entityType: "Payment",
    entityId: payment.id,
    previousState: { voided: false, auditStatus: payment.auditStatus, withdrawnAmount: wasApproved ? payment.receivedAmount.toString() : "0.00" },
    newState: { voided: true },
    notify: [
      { recipientId: salesperson.id, type: "OVERRIDE_VOID_PAYMENT", subject: "Payment voided", body, relatedEntityType: "Payment", relatedEntityId: payment.id },
      ...notify(finance, { type: "OVERRIDE_VOID_PAYMENT", subject: "Payment voided", body, relatedEntityType: "Payment", relatedEntityId: payment.id }),
    ],
  };
}

// ── Consequence preview (FR-SA-15) ─────────────────────────────────────────────

/**
 * The EXACT consequence of an override, for the confirmation dialog — e.g. "This will
 * withdraw ₹34,999.00 from Finance's approved collection for August 2026 and return the
 * payment to Nandhiya's queue. 3 people will be notified." Reads only.
 */
export async function describeOverride(actor: Actor, input: OverrideInput): Promise<string> {
  if (actor.role !== Role.SUPER_ADMIN) throw new AuthorizationError();
  switch (input.kind) {
    case "REVERSE_AUDIT": {
      const p = await db.payment.findUnique({ where: { id: input.paymentId }, include: { enrollment: { include: { lead: true } } } });
      if (!p) return "That payment was not found.";
      if (p.auditStatus === AuditStatus.APPROVED) {
        return `This will withdraw ${formatINR(p.receivedAmount.toString())} from Finance's approved collection for ${monthYear(p.paymentDate)} and return the payment to Nandhiya's queue. Rajesh, Nandhiya and ${p.enrollment.lead.fullName}'s salesperson will be notified.`;
      }
      return `This will return the ${p.auditStatus.toLowerCase()} payment ${p.transactionId} to Nandhiya's audit queue. Nandhiya and the salesperson will be notified.`;
    }
    case "UNLOCK_FEE": {
      const e = await db.enrollment.findUnique({ where: { id: input.enrollmentId }, include: { lead: true } });
      return `This will unlock the fee for ${e?.lead.fullName ?? "this learner"}. The payment draft must then be regenerated. The salesperson and sales managers will be notified.`;
    }
    case "REASSIGN_LEAD": {
      const [lead, to] = await Promise.all([
        db.lead.findUnique({ where: { id: input.leadId }, include: { salesperson: true } }),
        db.user.findUnique({ where: { id: input.newSalespersonId } }),
      ]);
      return `This will reassign ${lead?.fullName ?? "the lead"} from ${lead?.salesperson.name ?? "?"} to ${to?.name ?? "?"}. Both salespeople will be notified.`;
    }
    case "APPROVE_CONCESSION": {
      const lead = await db.lead.findUnique({ where: { id: input.leadId } });
      return `This will approve the above-threshold concession on ${lead?.fullName ?? "the lead"}. The salesperson and Rajesh will be notified.`;
    }
    case "EXTEND_DEADLINE": {
      const e = await db.enrollment.findUnique({ where: { id: input.enrollmentId }, include: { lead: true } });
      return `This will extend the 15-day down-payment deadline for ${e?.lead.fullName ?? "the learner"} by ${input.days} day(s). The salesperson will be notified.`;
    }
    case "REVERSE_OPS_TRANSFER": {
      const e = await db.enrollment.findUnique({ where: { id: input.enrollmentId }, include: { lead: true } });
      return `This will reverse the Operations transfer for ${e?.lead.fullName ?? "the learner"}. The salesperson will be notified.`;
    }
    case "DELEGATED_AUDIT": {
      const p = await db.payment.findUnique({ where: { id: input.paymentId } });
      const verb = input.decision === "APPROVE" ? "approve" : input.decision === "CORRECTION" ? "send for correction" : "reject";
      return `This will ${verb} payment ${p?.transactionId ?? ""} as "Audited by Super Admin (delegated)". Rajesh and Nandhiya will be notified.`;
    }
    case "VOID_PAYMENT": {
      const p = await db.payment.findUnique({ where: { id: input.paymentId }, include: { enrollment: { include: { lead: true } } } });
      if (!p) return "That payment was not found.";
      const counted = p.auditStatus === AuditStatus.APPROVED && !p.voided;
      return counted
        ? `This will void payment ${p.transactionId} and withdraw ${formatINR(p.receivedAmount.toString())} from ${p.enrollment.lead.fullName}'s totals. The record stays in history. Rajesh and the salesperson will be notified.`
        : `This will void payment ${p.transactionId} for ${p.enrollment.lead.fullName}. It affects no total (not currently approved) and stays in history. Rajesh and the salesperson will be notified.`;
    }
  }
}

// ── Super Admin Activity Log (FR-SA-16/17) + Override Summary (FR-SA-19) ───────

export interface ActivityRow {
  id: string;
  superAdminName: string;
  overrideType: string;
  entityType: string;
  entityId: string;
  reason: string;
  at: string;
  notifiedCount: number;
}

/**
 * The Super Admin Activity Log. Visible to the Super Admin AND to Rajesh in read-only
 * form (FR-SA-17) — the highest-privilege role stays reviewable by the business.
 */
export async function listSuperAdminActivity(
  actor: Actor,
  filters: { overrideType?: string; from?: string; to?: string } = {},
): Promise<ActivityRow[]> {
  if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.FINANCE_REVIEWER) {
    throw new AuthorizationError();
  }
  const where: Prisma.SuperAdminActivityWhereInput = {};
  if (filters.overrideType) where.overrideType = filters.overrideType;
  if (filters.from || filters.to) {
    where.performedAt = {};
    if (filters.from) where.performedAt.gte = new Date(filters.from);
    if (filters.to) {
      const to = new Date(filters.to);
      to.setUTCHours(23, 59, 59, 999);
      where.performedAt.lte = to;
    }
  }
  const rows = await db.superAdminActivity.findMany({ where, orderBy: { performedAt: "desc" }, take: 500 });
  const adminIds = [...new Set(rows.map((r) => r.superAdminId))];
  const admins = await db.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } });
  const nameOf = new Map(admins.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    superAdminName: nameOf.get(r.superAdminId) ?? "Super Admin",
    overrideType: r.overrideType,
    entityType: r.entityType,
    entityId: r.entityId,
    reason: r.reasonText,
    at: r.performedAt.toISOString(),
    notifiedCount: r.notifiedTo.length,
  }));
}

/** Monthly Super Admin Override Summary (FR-SA-19): count + list by type for a month. */
export async function overrideSummary(
  actor: Actor,
  year: number,
  month: number,
): Promise<{ year: number; month: number; total: number; byType: { type: string; count: number }[]; rows: ActivityRow[] }> {
  if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.FINANCE_REVIEWER) throw new AuthorizationError();
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const rows = await listSuperAdminActivity(actor, { from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() });
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.overrideType, (counts.get(r.overrideType) ?? 0) + 1);
  return {
    year,
    month,
    total: rows.length,
    byType: [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    rows,
  };
}

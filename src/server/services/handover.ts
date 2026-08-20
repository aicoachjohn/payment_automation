/**
 * Handover chain: Sales → Data Management → Finance (business decision; see CLAUDE.md).
 *
 * ONE consolidated learner/payment record — never fragments — moves along a two-stage chain.
 * Sales assemble it and submit it to Nandhiya; she approves the payments on it and passes it
 * to Rajesh. Each stage is gated only by what THAT role owns, which is the point: Sales were
 * previously blocked by "no approved payment" and "an outstanding balance remains", neither
 * of which is theirs to fix, so the button could never succeed for them.
 *
 *   · salesMissing    — the record Sales are responsible for assembling (FR-SAL-67/68/69).
 *   · dataMgmtMissing — every payment audited, which is Nandhiya's desk.
 *
 * A balance may still be outstanding when it reaches Finance; Rajesh sees the balance and
 * chases it. Nothing here bypasses the audit gate — a payment still only reaches Finance's
 * statement once APPROVED (BR-15).
 */
import "server-only";
import { AuditStatus, HandoverStage, HandoverType, Role, UserStatus } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRecordAccess, requirePermission, type Actor } from "@/server/auth/permissions";
import { calculateBalance, gt, money, sum, round, formatINR } from "@/server/money";
import { isBasicComplete, advanceLeadStatus } from "@/server/services/leads";
import { notifyUser } from "@/server/notifications";

export class HandoverError extends Error {
  readonly code = "HANDOVER_ERROR";
}

export interface HandoverRecord {
  learner: { fullName: string; dob: string | null; address: string | null; email: string | null; mobile: string | null };
  course: { program: string; plan: string; comboMode: string | null; commencingDate: string | null; batch: string | null };
  pricing: { standardFee: string | null; concession: string; finalApprovedFee: string | null };
  payments: { number: number; type: string; received: string; date: string; transactionId: string; hasProof: boolean; auditStatus: string }[];
  totals: { totalReceived: string; balance: string };
  sales: { salesperson: string; leadSource: string | null; enrollmentDate: string; remarks: string | null };
}

export interface HandoverSnapshot {
  record: HandoverRecord;
  /** Blockers Sales must clear before submitting to Data Management. */
  salesMissing: string[];
  /** Blockers Nandhiya must clear before passing it to Finance. */
  dataMgmtMissing: string[];
  /** Sales may submit. */
  readyForDataMgmt: boolean;
  /** Nandhiya may pass it on. */
  readyForFinance: boolean;
}

/** Assemble the consolidated record and validate completeness (FR-SAL-67/68/69). */
export async function buildHandoverSnapshot(enrollmentId: string): Promise<HandoverSnapshot> {
  const e = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      lead: { include: { salesperson: { select: { name: true } } } },
      payments: { where: { voided: false }, orderBy: { paymentNumber: "asc" }, include: { proofs: { take: 1 } } },
    },
  });
  if (!e) throw new HandoverError("Enrollment not found.");
  const l = e.lead;

  const approved = e.payments.filter((p) => p.auditStatus === AuditStatus.APPROVED);
  const totalReceived = round(sum(approved.map((p) => p.receivedAmount.toString()))).toFixed(2);
  const balance = calculateBalance(
    e.finalApprovedFee?.toString() ?? "0",
    e.payments.map((p) => ({ receivedAmount: p.receivedAmount.toString(), auditStatus: p.auditStatus, voided: p.voided })),
  ).toFixed(2);

  const addressParts = [l.doorNo, l.street, l.district, l.state, l.pincode].filter(Boolean);
  const record: HandoverRecord = {
    learner: { fullName: l.fullName, dob: l.dob?.toISOString() ?? null, address: addressParts.length ? addressParts.join(", ") : null, email: l.email, mobile: l.mobile },
    course: { program: e.program, plan: e.plan, comboMode: e.comboMode, commencingDate: e.commencingDate?.toISOString() ?? null, batch: e.batch },
    pricing: { standardFee: e.standardFee?.toFixed(2) ?? null, concession: e.concessionAmount.toFixed(2), finalApprovedFee: e.finalApprovedFee?.toFixed(2) ?? null },
    payments: e.payments.map((p) => ({ number: p.paymentNumber, type: p.paymentType, received: p.receivedAmount.toFixed(2), date: p.paymentDate.toISOString(), transactionId: p.transactionId, hasProof: p.proofs.length > 0, auditStatus: p.auditStatus })),
    totals: { totalReceived, balance },
    sales: { salesperson: l.salesperson.name, leadSource: l.leadSource, enrollmentDate: l.createdAt.toISOString(), remarks: l.remarks },
  };

  // ── Stage 1: what SALES own (FR-SAL-68/69) ─────────────────────────────────
  // Deliberately says nothing about audit status or the balance. Those belong to the next
  // stage, and blocking Sales on them left them staring at an error they could not act on.
  const salesMissing: string[] = [];
  if (!isBasicComplete(l)) salesMissing.push("Complete basic details (name, DOB, full address, email, mobile)");
  if (!e.program || !e.plan) salesMissing.push("Course and plan");
  if (!e.finalApprovedFee) salesMissing.push("Final approved fee");
  if (!e.commencingDate) salesMissing.push("Commencing date");
  if (e.payments.length === 0) {
    salesMissing.push("At least one payment recorded with its proof");
  } else {
    for (const p of e.payments) {
      if (!p.transactionId?.trim()) salesMissing.push(`Transaction ID (payment #${p.paymentNumber})`);
      if (p.proofs.length === 0) salesMissing.push(`Payment screenshot (payment #${p.paymentNumber})`);
    }
  }

  // ── Stage 2: what DATA MANAGEMENT own ──────────────────────────────────────
  // Nandhiya passes it on once her desk is clear: nothing still open, and at least one
  // payment actually approved. An outstanding balance is fine — Finance chases it.
  const dataMgmtMissing: string[] = [];
  const stillOpen = e.payments.filter(
    (p) =>
      p.auditStatus === AuditStatus.PENDING_AUDIT ||
      p.auditStatus === AuditStatus.RESUBMITTED ||
      p.auditStatus === AuditStatus.CORRECTION_REQUIRED,
  );
  if (stillOpen.length > 0) {
    dataMgmtMissing.push(
      `Audit decision on payment #${stillOpen.map((p) => p.paymentNumber).join(", #")}`,
    );
  }
  if (approved.length === 0) dataMgmtMissing.push("At least one approved payment");

  // A payment above the fee can never be approved (FR-REC-04), so name it and the way out
  // rather than leaving Nandhiya to discover it one failed approval at a time.
  if (e.finalApprovedFee) {
    for (const p of stillOpen) {
      if (gt(round(money(totalReceived).plus(p.receivedAmount)), e.finalApprovedFee.toString())) {
        dataMgmtMissing.push(
          `Payment #${p.paymentNumber} (${formatINR(p.receivedAmount.toString())}) is more than the Final Approved Fee ` +
            `(${formatINR(e.finalApprovedFee.toString())}), so it cannot be approved as it stands — if the course is wrong, ` +
            "ask a Sales Manager or the Super Admin to unlock the fee so Sales can correct it",
        );
      }
    }
  }

  return {
    record,
    salesMissing,
    dataMgmtMissing,
    readyForDataMgmt: salesMissing.length === 0,
    readyForFinance: salesMissing.length === 0 && dataMgmtMissing.length === 0,
  };
}

/**
 * Stage 1 — Sales submit the assembled record to Data Management (FR-SAL-70).
 *
 * Gated ONLY on what Sales own. Whether the payments are approved, and whether anything is
 * still outstanding, is Nandhiya's business at the next stage.
 */
export async function submitToDataMgmt(
  actor: Actor,
  enrollmentId: string,
): Promise<{ message: string; handoverId: string }> {
  const e = await db.enrollment.findUnique({ where: { id: enrollmentId }, include: { lead: true } });
  if (!e) throw new HandoverError("Enrollment not found.");
  requireRecordAccess(actor, e.lead);

  const existing = await db.operationsHandover.findFirst({
    where: { enrollmentId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    throw new HandoverError(
      existing.stage === HandoverStage.WITH_FINANCE
        ? "This learner has already been handed over to Finance."
        : "This learner is already with Data Management for approval.",
    );
  }

  const snapshot = await buildHandoverSnapshot(enrollmentId);
  if (!snapshot.readyForDataMgmt) {
    throw new HandoverError(`Handover blocked. Missing: ${snapshot.salesMissing.join("; ")}.`);
  }

  const handover = await db.$transaction(async (tx) => {
    const h = await tx.operationsHandover.create({
      data: {
        enrollmentId,
        handoverType: HandoverType.MANUAL,
        stage: HandoverStage.WITH_DATA_MGMT,
        validatedFlag: true,
        handoverDate: new Date(),
        generatedBy: actor.userId,
        snapshot: snapshot.record as object,
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: enrollmentId,
      action: "HANDOVER_TO_DATA_MGMT",
      changes: [{ field: "stage", oldValue: null, newValue: HandoverStage.WITH_DATA_MGMT }],
      actor,
    });
    return h;
  });

  const auditors = await db.user.findMany({
    where: { role: Role.DATA_MGMT_AUDITOR, status: UserStatus.ACTIVE },
    select: { id: true, email: true },
  });
  for (const a of auditors) {
    await notifyUser({
      recipientId: a.id,
      recipientEmail: a.email,
      type: "HANDOVER_RECEIVED",
      subject: `Handover to review — ${e.lead.fullName}`,
      body: `${e.lead.fullName} has been handed over by Sales for your approval.`,
      relatedEntityType: "Enrollment",
      relatedEntityId: enrollmentId,
    });
  }

  return { message: "Handed over to Nandhiya (Data Management).", handoverId: handover.id };
}

/**
 * Stage 2 — Data Management pass the record to Finance, once every payment on it has been
 * audited and at least one approved. A balance may remain; Rajesh sees it and chases it.
 */
export async function submitToFinance(
  actor: Actor,
  handoverId: string,
): Promise<{ message: string; handoverId: string }> {
  requirePermission(actor, "payment:audit"); // DATA_MGMT_AUDITOR only
  const h = await db.operationsHandover.findUnique({
    where: { id: handoverId },
    include: { enrollment: { include: { lead: true } } },
  });
  if (!h) throw new HandoverError("Handover not found.");
  if (h.stage === HandoverStage.WITH_FINANCE) {
    throw new HandoverError("This learner is already with Finance.");
  }
  if (h.stage === HandoverStage.FINANCE_APPROVED) {
    throw new HandoverError("Finance has already signed this learner off.");
  }

  const snapshot = await buildHandoverSnapshot(h.enrollmentId);
  if (!snapshot.readyForFinance) {
    throw new HandoverError(
      `Cannot pass this to Finance yet. Outstanding: ${snapshot.dataMgmtMissing.join("; ")}.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.operationsHandover.update({
      where: { id: handoverId },
      data: {
        stage: HandoverStage.WITH_FINANCE,
        passedToFinanceBy: actor.userId,
        passedToFinanceAt: new Date(),
        // Re-snapshot: the payments have been audited since Sales assembled it.
        snapshot: snapshot.record as object,
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: h.enrollmentId,
      action: "HANDOVER_TO_FINANCE",
      changes: [{ field: "stage", oldValue: HandoverStage.WITH_DATA_MGMT, newValue: HandoverStage.WITH_FINANCE }],
      actor,
    });
    await advanceLeadStatus(tx, h.enrollment.leadId, actor);
  });

  const finance = await db.user.findMany({
    where: { role: Role.FINANCE_REVIEWER, status: UserStatus.ACTIVE },
    select: { id: true, email: true },
  });
  for (const f of finance) {
    await notifyUser({
      recipientId: f.id,
      recipientEmail: f.email,
      type: "HANDOVER_RECEIVED",
      subject: `Handover approved — ${h.enrollment.lead.fullName}`,
      body: `${h.enrollment.lead.fullName} has been approved by Data Management and handed over to Finance.`,
      relatedEntityType: "Enrollment",
      relatedEntityId: h.enrollmentId,
    });
  }

  return { message: "Handed over to Rajesh (Finance).", handoverId };
}

/**
 * Stage 3 — Finance's second-level sign-off (business decision; BR-18 relaxed).
 *
 * Deliberately scoped to the HANDOVER. Nothing here can change a payment's amount, date,
 * Transaction ID or audit status: Finance still holds no write permission over payment data,
 * so the money controls are untouched. Rajesh is signing off the record Nandhiya sent him.
 *
 * His decision does NOT filter the Finance statement either — a payment counts from the
 * moment Nandhiya approves it (BR-15), so money already collected can never go missing from
 * Finance's totals while a sign-off is pending.
 */
export async function financeApproveHandover(
  actor: Actor,
  handoverId: string,
): Promise<{ message: string }> {
  requirePermission(actor, "handover:finance-decide");
  const h = await loadForFinance(handoverId);

  await db.$transaction(async (tx) => {
    await tx.operationsHandover.update({
      where: { id: handoverId },
      data: {
        stage: HandoverStage.FINANCE_APPROVED,
        financeDecisionBy: actor.userId,
        financeDecisionAt: new Date(),
        financeRejectionReason: null,
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: h.enrollmentId,
      action: "HANDOVER_FINANCE_APPROVED",
      changes: [{ field: "stage", oldValue: HandoverStage.WITH_FINANCE, newValue: HandoverStage.FINANCE_APPROVED }],
      actor,
    });
  });

  await notifyRoles([Role.DATA_MGMT_AUDITOR], {
    type: "HANDOVER_RECEIVED",
    subject: `Finance approved — ${h.enrollment.lead.fullName}`,
    body: `Rajesh (Finance) has approved the handover for ${h.enrollment.lead.fullName}.`,
    enrollmentId: h.enrollmentId,
  });

  return { message: "Approved. This learner is now signed off by Finance." };
}

/**
 * Finance sends the record BACK to Data Management with a mandatory written reason, exactly
 * like every other rejection in the platform (BR-16). Nandhiya fixes what he flagged and
 * passes it to him again.
 */
export async function financeRejectHandover(
  actor: Actor,
  handoverId: string,
  reason: string,
): Promise<{ message: string }> {
  requirePermission(actor, "handover:finance-decide");
  if (!reason?.trim()) {
    throw new HandoverError("Say what is wrong with this record so Data Management can fix it.");
  }
  const h = await loadForFinance(handoverId);

  await db.$transaction(async (tx) => {
    await tx.operationsHandover.update({
      where: { id: handoverId },
      data: {
        stage: HandoverStage.WITH_DATA_MGMT,
        financeDecisionBy: actor.userId,
        financeDecisionAt: new Date(),
        financeRejectionReason: reason.trim(),
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: h.enrollmentId,
      action: "HANDOVER_FINANCE_REJECTED",
      changes: [
        { field: "stage", oldValue: HandoverStage.WITH_FINANCE, newValue: HandoverStage.WITH_DATA_MGMT },
        { field: "reason", oldValue: null, newValue: reason.trim() },
      ],
      actor,
    });
    await advanceLeadStatus(tx, h.enrollment.leadId, actor);
  });

  await notifyRoles([Role.DATA_MGMT_AUDITOR], {
    type: "HANDOVER_RECEIVED",
    subject: `Finance sent it back — ${h.enrollment.lead.fullName}`,
    body: `Rajesh (Finance) returned the handover for ${h.enrollment.lead.fullName}. Reason: ${reason.trim()}`,
    enrollmentId: h.enrollmentId,
  });

  return { message: "Sent back to Data Management with your reason." };
}

/** A handover that is actually sitting with Finance — the only thing Rajesh may decide on. */
async function loadForFinance(handoverId: string) {
  const h = await db.operationsHandover.findUnique({
    where: { id: handoverId },
    include: { enrollment: { include: { lead: true } } },
  });
  if (!h) throw new HandoverError("Handover not found.");
  if (h.stage === HandoverStage.WITH_DATA_MGMT) {
    throw new HandoverError("This record is still with Data Management — there is nothing to sign off yet.");
  }
  if (h.stage === HandoverStage.FINANCE_APPROVED) {
    throw new HandoverError("You have already signed this learner off.");
  }
  return h;
}

async function notifyRoles(
  roles: Role[],
  msg: { type: string; subject: string; body: string; enrollmentId: string },
): Promise<void> {
  const users = await db.user.findMany({
    where: { role: { in: roles }, status: UserStatus.ACTIVE },
    select: { id: true, email: true },
  });
  for (const u of users) {
    await notifyUser({
      recipientId: u.id,
      recipientEmail: u.email,
      type: msg.type,
      subject: msg.subject,
      body: msg.body,
      relatedEntityType: "Enrollment",
      relatedEntityId: msg.enrollmentId,
    });
  }
}

/** The consolidated record for a handover, available to Nandhiya, Rajesh, managers, SA
 *  and the owning salesperson (FR-SAL-71). */
export async function getHandover(actor: Actor, handoverId: string): Promise<{ id: string; enrollmentId: string; type: string; stage: HandoverStage; financeRejectionReason: string | null; financeDecisionAt: string | null; validated: boolean; handoverDate: string | null; record: HandoverRecord; missing: string[] }> {
  const h = await db.operationsHandover.findUnique({
    where: { id: handoverId },
    include: { enrollment: { include: { lead: true } } },
  });
  if (!h) throw new HandoverError("Handover not found.");
  requireRecordAccess(actor, h.enrollment.lead);
  const validationErrors = (h.validationErrors as { missing?: string[] } | null) ?? null;
  return {
    id: h.id,
    enrollmentId: h.enrollmentId,
    type: h.handoverType,
    stage: h.stage,
    financeRejectionReason: h.financeRejectionReason,
    financeDecisionAt: h.financeDecisionAt?.toISOString() ?? null,
    validated: h.validatedFlag,
    handoverDate: h.handoverDate?.toISOString() ?? null,
    record: h.snapshot as unknown as HandoverRecord,
    missing: validationErrors?.missing ?? [],
  };
}

/** List handovers visible to the actor (all for staff roles; own leads for a salesperson). */
export async function listHandovers(actor: Actor): Promise<{ id: string; learner: string; type: string; stage: HandoverStage; validated: boolean; handoverDate: string | null }[]> {
  const staff = actor.role === Role.DATA_MGMT_AUDITOR || actor.role === Role.FINANCE_REVIEWER || actor.role === Role.SUPER_ADMIN || actor.role === Role.SALES_MANAGER;
  const rows = await db.operationsHandover.findMany({
    where: staff ? {} : { enrollment: { lead: { salespersonId: actor.userId } } },
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((h) => ({ id: h.id, learner: h.enrollment.lead.fullName, type: h.handoverType, stage: h.stage, validated: h.validatedFlag, handoverDate: h.handoverDate?.toISOString() ?? null }));
}

/**
 * Operations handover (Phase 10, FR-SAL-67..71, BR-12). Assembles ONE consolidated
 * learner/payment record — never fragments — and refuses to hand over until every
 * required field is present, naming EXACTLY what is missing (FR-SAL-69). The same
 * validator and record shape serve both the MANUAL (fully-paid) and AUTO_DAY15 handovers.
 */
import "server-only";
import { AuditStatus, HandoverType, Role } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requireRecordAccess, type Actor } from "@/server/auth/permissions";
import { calculateBalance, lte } from "@/server/money";
import { isBasicComplete } from "@/server/services/leads";

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
  complete: boolean;
  missing: string[];
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
  const totalReceived = approved.reduce((acc, p) => acc + Number(p.receivedAmount), 0).toFixed(2);
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

  // Validation (FR-SAL-68): name EXACTLY what is missing (FR-SAL-69).
  const missing: string[] = [];
  if (!isBasicComplete(l)) missing.push("Complete basic details (name, DOB, full address, email, mobile)");
  if (!e.program || !e.plan) missing.push("Course and plan");
  if (!e.finalApprovedFee) missing.push("Final approved fee");
  if (!e.commencingDate) missing.push("Commencing date");
  if (approved.length === 0) missing.push("At least one approved payment");
  for (const p of approved) {
    if (!p.transactionId?.trim()) missing.push(`Transaction ID (payment #${p.paymentNumber})`);
    if (p.proofs.length === 0) missing.push(`Payment screenshot (payment #${p.paymentNumber})`);
  }
  if (!lte(balance, "0")) missing.push("Full payment (an outstanding balance remains)");

  return { record, complete: missing.length === 0, missing };
}

/**
 * Perform a MANUAL handover (FR-SAL-70). Validates first; if anything is missing it BLOCKS
 * and names the exact fields (FR-SAL-69). On success returns the confirmation string
 * exactly as specified. The AUTO_DAY15 handover is created by the 15-day rule directly.
 */
export async function performHandover(actor: Actor, enrollmentId: string): Promise<{ message: string; handoverId: string }> {
  const e = await db.enrollment.findUnique({ where: { id: enrollmentId }, include: { lead: true } });
  if (!e) throw new HandoverError("Enrollment not found.");
  requireRecordAccess(actor, e.lead);

  const snapshot = await buildHandoverSnapshot(enrollmentId);
  if (!snapshot.complete) {
    throw new HandoverError(`Handover blocked. Missing: ${snapshot.missing.join("; ")}.`);
  }

  const handover = await db.$transaction(async (tx) => {
    const h = await tx.operationsHandover.create({
      data: {
        enrollmentId,
        handoverType: HandoverType.MANUAL,
        validatedFlag: true,
        handoverDate: new Date(),
        generatedBy: actor.userId,
        snapshot: snapshot.record as object,
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: enrollmentId,
      action: "OPERATIONS_HANDOVER_MANUAL",
      changes: [{ field: "handoverType", oldValue: null, newValue: HandoverType.MANUAL }],
      actor,
    });
    return h;
  });

  // FR-SAL-70: the exact confirmation string.
  return { message: "Handover Successfully Sent.", handoverId: handover.id };
}

/** The consolidated record for a handover, available to Nandhiya, Rajesh, managers, SA
 *  and the owning salesperson (FR-SAL-71). */
export async function getHandover(actor: Actor, handoverId: string): Promise<{ id: string; type: string; validated: boolean; handoverDate: string | null; record: HandoverRecord; missing: string[] }> {
  const h = await db.operationsHandover.findUnique({
    where: { id: handoverId },
    include: { enrollment: { include: { lead: true } } },
  });
  if (!h) throw new HandoverError("Handover not found.");
  requireRecordAccess(actor, h.enrollment.lead);
  const validationErrors = (h.validationErrors as { missing?: string[] } | null) ?? null;
  return {
    id: h.id,
    type: h.handoverType,
    validated: h.validatedFlag,
    handoverDate: h.handoverDate?.toISOString() ?? null,
    record: h.snapshot as unknown as HandoverRecord,
    missing: validationErrors?.missing ?? [],
  };
}

/** List handovers visible to the actor (all for staff roles; own leads for a salesperson). */
export async function listHandovers(actor: Actor): Promise<{ id: string; learner: string; type: string; validated: boolean; handoverDate: string | null }[]> {
  const staff = actor.role === Role.DATA_MGMT_AUDITOR || actor.role === Role.FINANCE_REVIEWER || actor.role === Role.SUPER_ADMIN || actor.role === Role.SALES_MANAGER;
  const rows = await db.operationsHandover.findMany({
    where: staff ? {} : { enrollment: { lead: { salespersonId: actor.userId } } },
    include: { enrollment: { include: { lead: { select: { fullName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((h) => ({ id: h.id, learner: h.enrollment.lead.fullName, type: h.handoverType, validated: h.validatedFlag, handoverDate: h.handoverDate?.toISOString() ?? null }));
}

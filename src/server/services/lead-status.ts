/**
 * Lead status pipeline (FRD §3.4) — the status is SYSTEM-DRIVEN. Pure computation (no
 * DB, no server-only) from the actual state of the enrollment and its payments, so it is
 * unit-testable. `advanceLeadStatus` (in leads.ts) persists the result and audits the
 * transition. A salesperson may mark INTERESTED but can never set a later status by hand.
 *
 * Note: the two transient "received" markers (HOLDING_OR_STARTING_RECEIVED,
 * DOWN_PAYMENT_RECEIVED) are stamped by the payment-approval flow in Phase 7 at the
 * moment of approval; the stateless computation resolves to the actionable "pending"
 * states between approvals.
 */
import { LeadStatus, AuditStatus } from "@prisma/client";
import { calculateBalance, lte, type MoneyInput } from "@/server/money";

/** FRD §3.4 order — used to assert the pipeline advances and never goes backward. */
export const STATUS_ORDER: LeadStatus[] = [
  LeadStatus.NEW_LEAD,
  LeadStatus.INTERESTED,
  LeadStatus.BASIC_DETAILS_PENDING,
  LeadStatus.BASIC_DETAILS_RECEIVED,
  LeadStatus.PAYMENT_DRAFT_GENERATED,
  LeadStatus.PAYMENT_PENDING,
  LeadStatus.HOLDING_OR_STARTING_RECEIVED,
  LeadStatus.DOWN_PAYMENT_PENDING,
  LeadStatus.DOWN_PAYMENT_RECEIVED,
  LeadStatus.FINAL_PAYMENT_PENDING,
  LeadStatus.FULLY_PAID,
  LeadStatus.ENROLLMENT_COMPLETED,
  LeadStatus.OPERATIONS_HANDOVER,
];

export function statusRank(status: LeadStatus): number {
  return STATUS_ORDER.indexOf(status);
}

/**
 * Compute the correct lead status from real state. Returns the furthest-reached status.
 */
export function computeLeadStatus(state: {
  interested: boolean;
  basicDetailsComplete: boolean;
  draftGenerated: boolean;
  draftShared?: boolean;
  finalApprovedFee: MoneyInput | null;
  payments: { paymentNumber: number; auditStatus: AuditStatus; voided: boolean; receivedAmount: MoneyInput }[];
  enrollmentComplete?: boolean;
  operationsHandover?: boolean;
}): LeadStatus {
  const approved = state.payments.filter((p) => p.auditStatus === AuditStatus.APPROVED && !p.voided);
  const p1 = approved.some((p) => p.paymentNumber === 1);
  const p2 = approved.some((p) => p.paymentNumber === 2);

  const balance =
    state.finalApprovedFee != null
      ? calculateBalance(state.finalApprovedFee, state.payments)
      : null;
  const balanceZero = balance != null && lte(balance, 0);

  if (state.operationsHandover) return LeadStatus.OPERATIONS_HANDOVER;
  if (balanceZero) return state.enrollmentComplete ? LeadStatus.ENROLLMENT_COMPLETED : LeadStatus.FULLY_PAID;
  if (p2) return LeadStatus.FINAL_PAYMENT_PENDING;
  if (p1) return LeadStatus.DOWN_PAYMENT_PENDING;
  if (state.draftShared) return LeadStatus.PAYMENT_PENDING;
  if (state.draftGenerated) return LeadStatus.PAYMENT_DRAFT_GENERATED;
  if (state.basicDetailsComplete) return LeadStatus.BASIC_DETAILS_RECEIVED;
  if (state.interested) return LeadStatus.BASIC_DETAILS_PENDING;
  return LeadStatus.NEW_LEAD;
}

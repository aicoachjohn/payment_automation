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


// ── Approval status: where a lead stands in the Sales → Nandhiya → Finance chain ──────

/**
 * What a salesperson actually wants to know at a glance: has Nandhiya approved this, is it
 * still sitting with her, or has something come back to me?
 *
 * Deliberately separate from `computeLeadStatus`, which tracks the MONEY pipeline (draft
 * generated, down payment pending, fully paid). Those answer different questions and a lead
 * can be "Fully paid" while still waiting on an audit decision — which is exactly the
 * confusion this removes.
 *
 * Ordered by what the viewer must ACT on first: anything bounced back to Sales outranks
 * progress further down the chain, because it is the only state where they owe work.
 */
export type ApprovalState =
  | "NOT_SUBMITTED"
  | "CORRECTION_REQUIRED"
  | "PAYMENT_REJECTED"
  | "RETURNED_BY_FINANCE"
  | "AWAITING_AUDIT"
  | "WITH_DATA_MGMT"
  | "APPROVED_BY_DATA_MGMT"
  | "APPROVED_BY_FINANCE";

export function computeApprovalState(state: {
  payments: { auditStatus: AuditStatus; voided: boolean }[];
  handoverStage: "WITH_DATA_MGMT" | "WITH_FINANCE" | "FINANCE_APPROVED" | null;
  financeReturned: boolean;
}): ApprovalState {
  const live = state.payments.filter((p) => !p.voided);

  // Work owed by Sales comes first, whatever else is true.
  if (live.some((p) => p.auditStatus === AuditStatus.CORRECTION_REQUIRED)) return "CORRECTION_REQUIRED";
  if (live.some((p) => p.auditStatus === AuditStatus.REJECTED)) return "PAYMENT_REJECTED";
  if (state.financeReturned && state.handoverStage === "WITH_DATA_MGMT") return "RETURNED_BY_FINANCE";

  if (state.handoverStage === "FINANCE_APPROVED") return "APPROVED_BY_FINANCE";
  if (state.handoverStage === "WITH_FINANCE") return "APPROVED_BY_DATA_MGMT";
  if (state.handoverStage === "WITH_DATA_MGMT") return "WITH_DATA_MGMT";

  // Not handed over yet: say whether an audit decision is still outstanding.
  if (live.some((p) => p.auditStatus === AuditStatus.PENDING_AUDIT || p.auditStatus === AuditStatus.RESUBMITTED)) {
    return "AWAITING_AUDIT";
  }
  return "NOT_SUBMITTED";
}

/** Wording shown to every role, so Sales, Nandhiya and Rajesh read the same label. */
export const APPROVAL_LABEL: Record<ApprovalState, string> = {
  NOT_SUBMITTED: "Not submitted",
  CORRECTION_REQUIRED: "Correction needed",
  PAYMENT_REJECTED: "Payment rejected",
  RETURNED_BY_FINANCE: "Sent back by Finance",
  AWAITING_AUDIT: "Awaiting Nandhiya",
  WITH_DATA_MGMT: "Pending with Nandhiya",
  APPROVED_BY_DATA_MGMT: "Approved by Nandhiya",
  APPROVED_BY_FINANCE: "Approved by Finance",
};

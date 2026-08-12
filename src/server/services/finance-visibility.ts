/**
 * THE single place that decides what Finance can see (FR-DM-20, BR-15). A payment
 * reaches the Finance dashboard and the collection totals ONLY when Nandhiya has
 * APPROVED it (and it is not voided). Every Finance read (Phase 8) and every
 * "is this visible?" check must go through here — there is exactly one predicate.
 */
import { AuditStatus, type Prisma } from "@prisma/client";

/** The audit status at which a payment becomes visible to Finance. */
export const FINANCE_VISIBLE_STATUS = AuditStatus.APPROVED;

/** Prisma `where` fragment for Finance-visible payments. Compose with more filters. */
export function financeVisiblePaymentWhere(
  extra?: Prisma.PaymentWhereInput,
): Prisma.PaymentWhereInput {
  return { auditStatus: FINANCE_VISIBLE_STATUS, voided: false, ...extra };
}

/** Predicate form — is this specific payment visible to Finance? */
export function isVisibleToFinance(payment: { auditStatus: AuditStatus; voided: boolean }): boolean {
  return payment.auditStatus === FINANCE_VISIBLE_STATUS && !payment.voided;
}

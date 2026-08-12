/**
 * Pure payment rules (FRD §3.3, BR-07). Payment number and type are SYSTEM-derived —
 * never chosen by the user. No DB, so unit-testable.
 */
import { PaymentType } from "@prisma/client";
import { money, round, type Money, type MoneyInput } from "@/server/money";

/**
 * Derive the payment type from its number, whether the course has started, and whether
 * this payment brings the balance to zero (BR-07: if only two payments are made, the
 * 2nd becomes the Final Payment when the balance clears).
 */
export function derivePaymentType(
  paymentNumber: number,
  courseStarted: boolean,
  bringsBalanceToZero: boolean,
): PaymentType {
  if (paymentNumber <= 1) {
    return courseStarted ? PaymentType.COURSE_STARTING : PaymentType.COURSE_HOLDING;
  }
  if (paymentNumber === 2) {
    return bringsBalanceToZero ? PaymentType.FINAL_PAYMENT : PaymentType.DOWN_PAYMENT;
  }
  return PaymentType.FINAL_PAYMENT;
}

/**
 * The expected amount for a payment number from the instalment schedule. If the payment
 * number is beyond the schedule, the expected amount is whatever remains (outstanding).
 */
export function expectedAmountFor(
  schedule: { number: number; amount: MoneyInput }[],
  paymentNumber: number,
  outstanding: MoneyInput,
): Money {
  const instalment = schedule.find((s) => s.number === paymentNumber);
  if (instalment) return round(instalment.amount);
  return round(outstanding);
}

/** Whether a received amount clears the outstanding balance (to zero or below). */
export function clearsBalance(outstanding: MoneyInput, receivedAmount: MoneyInput): boolean {
  return round(money(outstanding).minus(money(receivedAmount))).lte(0);
}

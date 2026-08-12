/**
 * The ONLY place money arithmetic and formatting happens (BR-29, FR-REC-07/08).
 *
 * Money is always `Prisma.Decimal` (PostgreSQL NUMERIC(12,2)) — never a JS number,
 * never a float. All brochure prices in FRD §5.4.1 are GST-inclusive at 18%, so the
 * base fee is derived by extraction from the inclusive figure.
 *
 * Rounding rule (FR-REC-08): half-up to 2 decimal places, applied ONCE at the end of a
 * calculation chain — never intermediately. The core arithmetic helpers therefore keep
 * full precision; call `round()` (or a helper that rounds, e.g. `decomposeInclusive`)
 * only at the boundary where a value is stored or displayed.
 */
import { Prisma } from "@prisma/client";
import { AuditStatus } from "@prisma/client";
import { formatINR as formatINRString } from "@/lib/format";

export type Money = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal.Value; // string | number | Decimal

const D = Prisma.Decimal;

/** decimal.js half-up rounding mode (ROUND_HALF_UP = 4). */
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/**
 * Coerce a value into a Decimal. Accepts strings (preferred for exactness),
 * Decimals, and numbers. Passing a float is allowed for ergonomics but callers
 * should prefer strings for any literal with fractional rupees.
 */
export function money(value: MoneyInput): Money {
  return new D(value);
}

export function add(a: MoneyInput, b: MoneyInput): Money {
  return new D(a).plus(b);
}

export function sub(a: MoneyInput, b: MoneyInput): Money {
  return new D(a).minus(b);
}

export function mul(a: MoneyInput, b: MoneyInput): Money {
  return new D(a).times(b);
}

/** Sum a list of amounts. Empty list → 0. Full precision (round at the boundary). */
export function sum(list: readonly MoneyInput[]): Money {
  return list.reduce<Money>((acc, x) => acc.plus(x), new D(0));
}

/** The single documented rounding rule: half-up to 2 decimal places (FR-REC-08). */
export function round(value: MoneyInput): Money {
  return new D(value).toDecimalPlaces(2, HALF_UP);
}

/**
 * Exact integer paise for a money amount (rounded once). This is the ONLY sanctioned way
 * to obtain a JS `number` from money, and it is for GEOMETRY/PRESENTATION ONLY (e.g. a
 * chart bar height) — never for money arithmetic, which must stay in Decimal (FR-REC-07).
 * Being an integer count of paise, it carries no floating-point error for 2dp values.
 */
export function toPaise(value: MoneyInput): number {
  return round(value).times(100).toNumber();
}

/** true if two amounts are numerically equal (ignores scale, e.g. 1 == 1.00). */
export function eq(a: MoneyInput, b: MoneyInput): boolean {
  return new D(a).equals(new D(b));
}

/** Divide, full precision (round at the boundary). */
export function div(a: MoneyInput, b: MoneyInput): Money {
  return new D(a).div(b);
}

/** `percent`% of `amount`, full precision (e.g. percentOf(24999, 10) = 2499.9). */
export function percentOf(amount: MoneyInput, percent: MoneyInput): Money {
  return new D(amount).times(new D(percent).div(100));
}

export function lt(a: MoneyInput, b: MoneyInput): boolean {
  return new D(a).lt(b);
}
export function lte(a: MoneyInput, b: MoneyInput): boolean {
  return new D(a).lte(b);
}
export function gt(a: MoneyInput, b: MoneyInput): boolean {
  return new D(a).gt(b);
}
export function gte(a: MoneyInput, b: MoneyInput): boolean {
  return new D(a).gte(b);
}

/** The smaller of two amounts. */
export function min(a: MoneyInput, b: MoneyInput): Money {
  const da = new D(a);
  return da.lte(b) ? da : new D(b);
}

/**
 * Add GST to a base fee, returning the GST-inclusive amount. Full precision — the
 * inverse of `extractBase`. Round at the boundary when storing/displaying.
 */
export function applyGst(baseFee: MoneyInput, gstPercent: MoneyInput): Money {
  const factor = new D(gstPercent).div(100).plus(1);
  return new D(baseFee).times(factor);
}

/**
 * Extract the pre-GST base fee from a GST-INCLUSIVE amount. Full precision — the
 * inverse of `applyGst`, so `applyGst(extractBase(x, g), g)` round-trips to x.
 */
export function extractBase(inclusiveFee: MoneyInput, gstPercent: MoneyInput): Money {
  const factor = new D(gstPercent).div(100).plus(1);
  return new D(inclusiveFee).div(factor);
}

/**
 * Split a GST-inclusive brochure price into stored components such that
 * baseFee + gstAmount === standardFee EXACTLY at 2dp. This is the boundary helper:
 * it rounds once, here, so the three stored NUMERIC(12,2) values always reconcile.
 */
export function decomposeInclusive(
  inclusiveFee: MoneyInput,
  gstPercent: MoneyInput,
): { baseFee: Money; gstAmount: Money; standardFee: Money } {
  const standardFee = round(inclusiveFee);
  const baseFee = round(extractBase(standardFee, gstPercent));
  const gstAmount = round(sub(standardFee, baseFee)); // remainder → exact reconciliation
  return { baseFee, gstAmount, standardFee };
}

/**
 * Format an amount as INR with Indian digit grouping (NFR-14): ₹1,24,999.00.
 * Rounds half-up to 2dp for display.
 */
export function formatINR(value: MoneyInput): string {
  // Round once (the money rule), then delegate to the client-safe grouping formatter.
  return formatINRString(round(value).toFixed(2));
}

/** Minimal shape needed to decide whether a payment reduces the balance. */
export interface BalancePayment {
  receivedAmount: MoneyInput;
  auditStatus: AuditStatus;
  voided: boolean;
}

/**
 * The ONLY balance function in the codebase (BR-22, FR-REC-06).
 *
 * Balance = final_approved_fee − sum of APPROVED, non-voided received amounts.
 * Pending, correction-required, resubmitted and rejected payments never reduce the
 * balance. The function filters defensively rather than trusting the caller, so an
 * unapproved payment can never leak into a total. Result is rounded once, at the end.
 */
export function calculateBalance(
  finalApprovedFee: MoneyInput,
  payments: readonly BalancePayment[],
): Money {
  const approvedReceived = sum(
    payments
      .filter((p) => p.auditStatus === AuditStatus.APPROVED && !p.voided)
      .map((p) => p.receivedAmount),
  );
  return round(sub(finalApprovedFee, approvedReceived));
}

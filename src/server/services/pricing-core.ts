/**
 * Pure fee math (no DB, no server-only) — the testable core of the pricing engine.
 * All money arithmetic goes through src/server/money. The DB-backed, effective-dated
 * resolution, fee lock/unlock and config lookups live in ./pricing (server-only).
 */
import {
  Program,
  Plan,
  ComboMode,
  ConcessionStatus,
  ConcessionThresholdType,
  type PricingMaster,
} from "@prisma/client";
import {
  money,
  round,
  add,
  sub,
  sum,
  eq,
  gt,
  lte,
  min,
  percentOf,
  type Money,
  type MoneyInput,
} from "@/server/money";

/** A safe, user-facing pricing error (NFR-11). */
export class PricingError extends Error {
  readonly code = "PRICING_ERROR";
}

// ── Fee quote ───────────────────────────────────────────────────────────────

export interface FeeSelection {
  program: Program;
  plan: Plan;
  comboMode?: ComboMode | null;
  asOfDate?: Date;
}

export interface FeeQuote {
  pricingId: string;
  standardFee: Money;
  baseFee: Money;
  gstAmount: Money;
  gstPercent: Money;
}

/** Pick the applicable inclusive fee from a Pricing Master row (pure). */
export function resolveStandardFee(
  row: PricingMaster,
  program: Program,
  plan: Plan,
  comboMode?: ComboMode | null,
): Money {
  if (program === Program.COMBO_ALL_THREE) {
    if (!comboMode) {
      throw new PricingError("Choose Single Shot or Double Shot for the Combo Pack.");
    }
    const fee = comboMode === ComboMode.DOUBLE_SHOT ? row.doubleShotFee : row.singleShotFee;
    if (fee == null) throw new PricingError("Combo pricing is not configured for this plan.");
    return money(fee);
  }
  const fee = plan === Plan.ADVANCED ? row.advancedFee : row.premiumFee;
  if (fee == null) throw new PricingError("Pricing is not configured for this program and plan.");
  return money(fee);
}

// ── Concession ────────────────────────────────────────────────────────────────

export interface ConcessionThreshold {
  amount: MoneyInput;
  percent: MoneyInput;
}

export interface ConcessionInput {
  standardFee: MoneyInput;
  concessionValue: MoneyInput;
  concessionType: ConcessionThresholdType; // AMOUNT | PERCENTAGE
  threshold: ConcessionThreshold;
}

export interface ConcessionResult {
  concessionAmount: Money;
  finalApprovedFee: Money;
  thresholdValue: Money;
  requiresApproval: boolean;
  concessionStatus: ConcessionStatus;
}

/**
 * Apply a concession (value or percentage) and decide whether it needs approval (pure).
 * Auto-approved at or below the per-plan threshold; above it → PENDING_APPROVAL, which
 * blocks payment-draft generation until a Manager/Admin approves (FR-SAL-27). The
 * mandatory reason (BR-04) is enforced at the input boundary, not in this math.
 */
export function applyConcession(input: ConcessionInput): ConcessionResult {
  const std = money(input.standardFee);
  const rawConcession =
    input.concessionType === ConcessionThresholdType.PERCENTAGE
      ? percentOf(std, input.concessionValue)
      : money(input.concessionValue);
  const concessionAmount = round(rawConcession);
  const thresholdValue = round(min(input.threshold.amount, percentOf(std, input.threshold.percent)));

  if (lte(concessionAmount, 0)) {
    return {
      concessionAmount: round(0),
      finalApprovedFee: round(std),
      thresholdValue,
      requiresApproval: false,
      concessionStatus: ConcessionStatus.NONE,
    };
  }

  const finalApprovedFee = round(sub(std, concessionAmount));
  if (lte(finalApprovedFee, 0)) {
    throw new PricingError("A concession cannot reduce the fee to zero or below.");
  }

  const requiresApproval = gt(concessionAmount, thresholdValue);
  return {
    concessionAmount,
    finalApprovedFee,
    thresholdValue,
    requiresApproval,
    concessionStatus: requiresApproval ? ConcessionStatus.PENDING_APPROVAL : ConcessionStatus.AUTO_APPROVED,
  };
}

// ── Payment schedule ──────────────────────────────────────────────────────────

export interface ScheduleInstalment {
  number: number;
  amount: Money;
  dueDate: Date;
  percent?: number;
}

export interface BuildScheduleInput {
  finalApprovedFee: MoneyInput;
  startDate: Date;
  splits?: number[];
  intervalDays?: number[];
  custom?: { amount: MoneyInput; dueDate: Date }[];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function assertSumsExactly(instalments: ScheduleInstalment[], fee: Money): void {
  const total = sum(instalments.map((i) => i.amount));
  if (!eq(total, fee)) {
    throw new PricingError(
      `Instalments (${total.toFixed(2)}) do not sum to the final approved fee (${fee.toFixed(2)}).`,
    );
  }
}

/**
 * Build the instalment plan (pure). Percentage splits are rounded per instalment and the
 * LAST instalment absorbs the rounding remainder, so the total ALWAYS equals the final
 * approved fee exactly (asserted; fails loudly otherwise).
 */
export function buildPaymentSchedule(input: BuildScheduleInput): ScheduleInstalment[] {
  const fee = round(input.finalApprovedFee);

  if (input.custom && input.custom.length > 0) {
    const instalments = input.custom.map((c, i) => ({
      number: i + 1,
      amount: round(c.amount),
      dueDate: c.dueDate,
    }));
    assertSumsExactly(instalments, fee);
    return instalments;
  }

  const splits = input.splits && input.splits.length > 0 ? input.splits : [100];
  const intervals = input.intervalDays ?? splits.map((_, i) => i * 15);

  const amounts: Money[] = [];
  let running: Money = money(0);
  splits.forEach((pct, i) => {
    if (i === splits.length - 1) {
      amounts.push(round(sub(fee, running)));
    } else {
      const amount = round(percentOf(fee, pct));
      amounts.push(amount);
      running = add(running, amount);
    }
  });

  const instalments = amounts.map((amount, i) => ({
    number: i + 1,
    amount,
    dueDate: addDays(input.startDate, intervals[i] ?? i * 15),
    percent: splits[i],
  }));
  assertSumsExactly(instalments, fee);
  return instalments;
}

// ── Draft-generation gate ─────────────────────────────────────────────────────

/** Reasons the payment draft cannot yet be generated (FR-SAL-27). Empty = allowed. */
export function draftBlockers(enrollment: {
  concessionStatus: ConcessionStatus;
  finalApprovedFee: Money | null;
}): string[] {
  const blockers: string[] = [];
  if (enrollment.concessionStatus === ConcessionStatus.PENDING_APPROVAL) {
    blockers.push("The concession is above the threshold and needs Manager/Admin approval.");
  }
  return blockers;
}

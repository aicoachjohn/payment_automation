/**
 * Pricing & fee engine — DB-backed layer (FR-SAL-20..31, FR-ADM-01..05, BR-01/03/04/
 * 13/19). Pure fee math lives in ./pricing-core; this module adds effective-dated
 * resolution, config lookups and fee lock/unlock. Pricing is effective-dated: the
 * engine applies the rate effective on the date the fee is LOCKED, and a later Pricing
 * Master change never moves a locked lead (FR-ADM-02/03).
 */
import "server-only";
import { Program, Plan, ComboMode, PricingStatus } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { money, round, sub, lte, decomposeInclusive } from "@/server/money";
import {
  PricingError,
  resolveStandardFee,
  buildPaymentSchedule,
  draftBlockers,
  type FeeSelection,
  type FeeQuote,
  type ConcessionThreshold,
} from "@/server/services/pricing-core";

// Re-export the pure core so callers can import everything from "@/server/services/pricing".
export * from "@/server/services/pricing-core";

/**
 * Find the Pricing Master row effective at `asOfDate` for the selection and return the
 * fee breakdown. Combo rows are keyed by (program, plan); standard rows by program.
 */
export async function calculateFee(selection: FeeSelection): Promise<FeeQuote> {
  const asOf = selection.asOfDate ?? new Date();
  if (selection.program === Program.COMBO_ALL_THREE && !selection.comboMode) {
    throw new PricingError("Choose Single Shot or Double Shot for the Combo Pack.");
  }

  const row = await db.pricingMaster.findFirst({
    where: {
      program: selection.program,
      plan: selection.program === Program.COMBO_ALL_THREE ? selection.plan : null,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!row) {
    throw new PricingError("No pricing is configured for this selection on that date.");
  }

  const standardFee = resolveStandardFee(row, selection.program, selection.plan, selection.comboMode);
  const { baseFee, gstAmount, standardFee: std } = decomposeInclusive(standardFee, row.gstPercent);
  return { pricingId: row.id, standardFee: std, baseFee, gstAmount, gstPercent: money(row.gstPercent) };
}

// ── Config-backed resolvers (BR-13) ──────────────────────────────────────────

const DEFAULT_THRESHOLD: ConcessionThreshold = { amount: 2000, percent: 10 };

/** Per-plan concession threshold (FR-ADM-05, FR-SAL-28), read from SystemConfig. */
export async function getConcessionThreshold(plan: Plan): Promise<ConcessionThreshold> {
  const row = await db.systemConfig.findUnique({ where: { key: "concession_threshold" } });
  const cfg = row?.value as Record<string, { amount: number; percent: number }> | undefined;
  const forPlan = cfg?.[plan];
  if (forPlan && typeof forPlan.amount === "number" && typeof forPlan.percent === "number") {
    return { amount: forPlan.amount, percent: forPlan.percent };
  }
  return DEFAULT_THRESHOLD;
}

/** Percentage splits for a selection (Q-04/Q-05 defaults), read from SystemConfig. */
export async function getScheduleSplits(comboMode?: ComboMode | null): Promise<number[]> {
  const key =
    comboMode === ComboMode.DOUBLE_SHOT
      ? "double_shot_split"
      : comboMode === ComboMode.SINGLE_SHOT
        ? "single_shot_split"
        : "payment_schedule_default";
  const row = await db.systemConfig.findUnique({ where: { key } });
  const value = row?.value;
  if (Array.isArray(value) && value.every((n) => typeof n === "number") && value.length > 0) {
    return value as number[];
  }
  return comboMode === ComboMode.DOUBLE_SHOT ? [50, 50] : comboMode === ComboMode.SINGLE_SHOT ? [100] : [40, 40, 20];
}

// ── Fee lock / unlock (FR-SAL-23/24, BR-19) ───────────────────────────────────

/**
 * Lock the fee onto an enrollment at draft-generation time. Recomputes at the CURRENT
 * effective rate, snapshots pricing_id + base/GST/standard/final onto the enrollment,
 * stores the payment schedule and stamps fee_locked_at. A locked fee must be unlocked
 * (with reason + approval) before re-locking.
 */
export async function lockFee(
  enrollmentId: string,
  actor: Actor,
  opts: { startDate?: Date } = {},
): Promise<void> {
  const enrollment = await db.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) throw new PricingError("Enrollment not found.");
  if (enrollment.feeLockedAt) throw new PricingError("The fee is already locked for this lead.");

  const blockers = draftBlockers({
    concessionStatus: enrollment.concessionStatus,
    finalApprovedFee: enrollment.finalApprovedFee ? money(enrollment.finalApprovedFee) : null,
  });
  if (blockers.length > 0) throw new PricingError(blockers.join(" "));

  const now = new Date();
  const quote = await calculateFee({
    program: enrollment.program,
    plan: enrollment.plan,
    comboMode: enrollment.comboMode,
    asOfDate: now,
  });
  const concessionAmount = round(enrollment.concessionAmount ?? 0);
  const finalApprovedFee = round(sub(quote.standardFee, concessionAmount));
  if (lte(finalApprovedFee, 0)) {
    throw new PricingError("The final approved fee must be greater than zero.");
  }

  const splits = await getScheduleSplits(enrollment.comboMode);
  const schedule = buildPaymentSchedule({
    finalApprovedFee,
    startDate: opts.startDate ?? enrollment.commencingDate ?? now,
    splits,
  });

  await db.$transaction(async (tx) => {
    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        pricingId: quote.pricingId,
        standardFee: quote.standardFee.toFixed(2),
        baseFee: quote.baseFee.toFixed(2),
        gstAmount: quote.gstAmount.toFixed(2),
        gstPercent: quote.gstPercent.toFixed(2),
        finalApprovedFee: finalApprovedFee.toFixed(2),
        feeLockedAt: now,
        enrollmentStatus: "FEE_LOCKED",
        paymentSchedule: schedule.map((s) => ({
          number: s.number,
          amount: s.amount.toFixed(2),
          dueDate: s.dueDate.toISOString(),
          percent: s.percent ?? null,
        })),
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: enrollmentId,
      action: "FEE_LOCK",
      changes: [
        { field: "pricingId", oldValue: enrollment.pricingId, newValue: quote.pricingId },
        { field: "standardFee", oldValue: enrollment.standardFee, newValue: quote.standardFee.toFixed(2) },
        { field: "finalApprovedFee", oldValue: enrollment.finalApprovedFee, newValue: finalApprovedFee.toFixed(2) },
        { field: "feeLockedAt", oldValue: null, newValue: now },
      ],
      actor,
    });
  });
}

/**
 * Unlock a locked fee — requires the `fee:unlock` permission (Manager/Super Admin), a
 * documented reason, records previous/new to the audit trail, and returns the lead to a
 * DRAFT state so the payment draft must be regenerated (FR-SAL-24, FR-SA-09, BR-19).
 */
export async function unlockFee(enrollmentId: string, actor: Actor, reason: string): Promise<void> {
  requirePermission(actor, "fee:unlock");
  if (!reason || reason.trim().length === 0) {
    throw new PricingError("A documented reason is required to unlock a fee.");
  }
  const enrollment = await db.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) throw new PricingError("Enrollment not found.");
  if (!enrollment.feeLockedAt) throw new PricingError("The fee is not locked.");

  await db.$transaction(async (tx) => {
    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: { feeLockedAt: null, enrollmentStatus: "DRAFT" },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: enrollmentId,
      action: "FEE_UNLOCK",
      changes: [
        { field: "feeLockedAt", oldValue: enrollment.feeLockedAt, newValue: null },
        { field: "reason", oldValue: null, newValue: reason.trim() },
      ],
      actor,
    });
  });
}

/** Read helper: the currently-effective pricing rows (for the admin list & fee calc). */
export async function listEffectivePricing(asOf: Date = new Date()) {
  return db.pricingMaster.findMany({
    where: {
      status: PricingStatus.ACTIVE,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    },
    orderBy: [{ program: "asc" }, { plan: "asc" }],
  });
}

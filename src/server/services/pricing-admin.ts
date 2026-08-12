/**
 * Pricing Master administration (FR-ADM-01..05/08/09). Super-Admin-scoped writes.
 * Editing a rate is EFFECTIVE-DATED: it closes the previous row (sets effective_to) and
 * inserts a NEW row — history is never mutated (FR-ADM-03). Every change writes an audit
 * entry with previous and new value (FR-ADM-04). Thresholds, reason codes and schedule
 * splits are configuration (SystemConfig), editable without a code change (BR-13).
 */
import "server-only";
import { Plan, Program, PricingStatus, ComboMode } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { PricingError } from "@/server/services/pricing-core";

export interface PricingInput {
  program: Program;
  plan?: Plan | null;
  advancedFee?: string | null;
  premiumFee?: string | null;
  singleShotFee?: string | null;
  doubleShotFee?: string | null;
  comboFee?: string | null;
  discount?: string | null;
  gstPercent?: string;
  effectiveFrom?: string; // ISO date; defaults to now
  specialPricingName?: string | null;
}

function validatePricingShape(input: PricingInput): void {
  if (input.program === Program.COMBO_ALL_THREE) {
    if (!input.plan) throw new PricingError("Combo pricing requires a plan (Advanced or Premium).");
    if (input.singleShotFee == null || input.doubleShotFee == null) {
      throw new PricingError("Combo pricing requires both Single Shot and Double Shot fees.");
    }
  } else {
    if (input.advancedFee == null || input.premiumFee == null) {
      throw new PricingError("Standard pricing requires both Advanced and Premium fees.");
    }
  }
}

function toRow(input: PricingInput, actorId: string, effectiveFrom: Date) {
  return {
    program: input.program,
    plan: input.program === Program.COMBO_ALL_THREE ? (input.plan ?? null) : null,
    advancedFee: input.advancedFee ?? null,
    premiumFee: input.premiumFee ?? null,
    singleShotFee: input.singleShotFee ?? null,
    doubleShotFee: input.doubleShotFee ?? null,
    comboFee: input.comboFee ?? null,
    discount: input.discount ?? null,
    gstPercent: input.gstPercent ?? "18",
    effectiveFrom,
    specialPricingFlag: Boolean(input.specialPricingName),
    specialPricingName: input.specialPricingName ?? null,
    status: PricingStatus.ACTIVE,
    createdBy: actorId,
  };
}

export async function createPricing(actor: Actor, input: PricingInput): Promise<{ id: string }> {
  requirePermission(actor, "pricing:write");
  validatePricingShape(input);
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();

  const created = await db.$transaction(async (tx) => {
    const row = await tx.pricingMaster.create({ data: toRow(input, actor.userId, effectiveFrom) });
    await writeAudit(tx, {
      entityType: "PricingMaster",
      entityId: row.id,
      action: "CREATE",
      changes: [
        { field: "program", oldValue: null, newValue: input.program },
        { field: "plan", oldValue: null, newValue: input.plan ?? null },
        { field: "effectiveFrom", oldValue: null, newValue: effectiveFrom },
      ],
      actor,
    });
    return row;
  });
  return { id: created.id };
}

/**
 * Edit a rate: close the current row and insert a new effective-dated one. The previous
 * row remains, bounded by effective_to, so leads locked under it are unaffected.
 */
export async function updatePricing(
  actor: Actor,
  pricingId: string,
  input: PricingInput,
): Promise<{ id: string }> {
  requirePermission(actor, "pricing:write");
  const previous = await db.pricingMaster.findUnique({ where: { id: pricingId } });
  if (!previous) throw new PricingError("Pricing entry not found.");
  validatePricingShape(input);
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  if (effectiveFrom <= previous.effectiveFrom) {
    throw new PricingError("The new effective date must be after the current one.");
  }

  const created = await db.$transaction(async (tx) => {
    await tx.pricingMaster.update({
      where: { id: pricingId },
      data: { effectiveTo: effectiveFrom },
    });
    const row = await tx.pricingMaster.create({ data: toRow(input, actor.userId, effectiveFrom) });
    await writeAudit(tx, {
      entityType: "PricingMaster",
      entityId: row.id,
      action: "UPDATE",
      changes: [
        { field: "supersedes", oldValue: previous.id, newValue: row.id },
        { field: "advancedFee", oldValue: previous.advancedFee, newValue: input.advancedFee ?? null },
        { field: "premiumFee", oldValue: previous.premiumFee, newValue: input.premiumFee ?? null },
        { field: "singleShotFee", oldValue: previous.singleShotFee, newValue: input.singleShotFee ?? null },
        { field: "doubleShotFee", oldValue: previous.doubleShotFee, newValue: input.doubleShotFee ?? null },
        { field: "effectiveFrom", oldValue: previous.effectiveFrom, newValue: effectiveFrom },
      ],
      actor,
    });
    return row;
  });
  return { id: created.id };
}

export async function deactivatePricing(actor: Actor, pricingId: string): Promise<void> {
  requirePermission(actor, "pricing:write");
  const row = await db.pricingMaster.findUnique({ where: { id: pricingId } });
  if (!row) throw new PricingError("Pricing entry not found.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.pricingMaster.update({
      where: { id: pricingId },
      data: { status: PricingStatus.INACTIVE, effectiveTo: row.effectiveTo ?? now },
    });
    await writeAudit(tx, {
      entityType: "PricingMaster",
      entityId: pricingId,
      action: "DEACTIVATE",
      changes: [{ field: "status", oldValue: row.status, newValue: PricingStatus.INACTIVE }],
      actor,
    });
  });
}

export async function listAllPricing() {
  return db.pricingMaster.findMany({
    orderBy: [{ program: "asc" }, { plan: "asc" }, { effectiveFrom: "desc" }],
  });
}

// ── Concession threshold (per plan) ───────────────────────────────────────────

export type ConcessionThresholdConfig = Record<string, { amount: string; percent: string }>;

export async function getConcessionThresholdConfig(): Promise<ConcessionThresholdConfig> {
  const row = await db.systemConfig.findUnique({ where: { key: "concession_threshold" } });
  const stored = row?.value as Record<string, { amount: unknown; percent: unknown }> | undefined;
  if (!stored) return { ADVANCED: { amount: "2000", percent: "10" }, PREMIUM: { amount: "2000", percent: "10" } };
  // Normalise any legacy numeric values to exact-decimal strings (FR-REC-07).
  const out: ConcessionThresholdConfig = {};
  for (const [plan, v] of Object.entries(stored)) out[plan] = { amount: String(v.amount), percent: String(v.percent) };
  return out;
}

export async function setConcessionThreshold(
  actor: Actor,
  plan: Plan,
  value: { amount: string; percent: string },
): Promise<void> {
  requirePermission(actor, "config:write");
  const current = await getConcessionThresholdConfig();
  const next = { ...current, [plan]: value };
  await db.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key: "concession_threshold" },
      update: { value: next, updatedBy: actor.userId },
      create: { key: "concession_threshold", value: next, updatedBy: actor.userId, description: "Per-plan concession approval threshold (amount cap and percent cap; lower applies)." },
    });
    await writeAudit(tx, {
      entityType: "SystemConfig",
      entityId: "concession_threshold",
      action: "UPDATE",
      changes: [{ field: plan, oldValue: current[plan] ?? null, newValue: value }],
      actor,
    });
  });
}

// ── Audit reason codes (FR-ADM-09, FR-DM-17) ──────────────────────────────────

export async function listReasonCodes(): Promise<string[]> {
  const row = await db.systemConfig.findUnique({ where: { key: "audit_reason_codes" } });
  const value = row?.value;
  return Array.isArray(value) ? (value as string[]) : [];
}

export async function setReasonCodes(actor: Actor, codes: string[]): Promise<void> {
  requirePermission(actor, "config:write");
  const cleaned = Array.from(new Set(codes.map((c) => c.trim()).filter(Boolean)));
  const previous = await listReasonCodes();
  await db.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key: "audit_reason_codes" },
      update: { value: cleaned, updatedBy: actor.userId },
      create: { key: "audit_reason_codes", value: cleaned, updatedBy: actor.userId, description: "Standard audit reason-code list (L1 audit)." },
    });
    await writeAudit(tx, {
      entityType: "SystemConfig",
      entityId: "audit_reason_codes",
      action: "UPDATE",
      changes: [{ field: "codes", oldValue: previous.join(", "), newValue: cleaned.join(", ") }],
      actor,
    });
  });
}

// Re-export for callers that only need the read side.
export type { ComboMode };

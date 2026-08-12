/**
 * Payment-draft generator (FR-SAL-32..36, FR-SAL-13/23). One click assembles the
 * complete, ready-to-send enrollment message. A salesperson never types it by hand.
 *
 * Guardrails: generation is BLOCKED until all mandatory basic details are valid and any
 * above-threshold concession is approved — and when blocked it names exactly what is
 * missing. On generation it locks the fee (Phase 3), stores the rendered content plus a
 * JSON snapshot, advances the lead to PAYMENT_DRAFT_GENERATED, and audits. Regeneration
 * creates a NEW version; every previous version is retained.
 */
import "server-only";
import { ConcessionStatus } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { getLeadForActor, advanceLeadStatus, LeadError } from "@/server/services/leads";
import { lockFee } from "@/server/services/pricing";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import {
  buildDraftContext,
  renderTemplate,
  missingBasicFields,
  DEFAULT_DRAFT_TEMPLATE,
  DEFAULT_BANK_DETAILS,
  DEFAULT_DRAFT_INSTRUCTION,
} from "@/server/services/draft-template";

export class DraftError extends Error {
  readonly code = "DRAFT_ERROR";
}

export interface DraftConfig {
  template: string;
  bankDetails: string;
  instruction: string;
  whatsappEnabled: boolean;
}

export async function getDraftConfig(): Promise<DraftConfig> {
  const rows = await db.systemConfig.findMany({
    where: { key: { in: ["payment_draft_template", "company_bank_details", "payment_draft_instruction", "whatsapp_enabled"] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const str = (k: string, fallback: string) => (typeof map.get(k) === "string" ? (map.get(k) as string) : fallback);
  return {
    template: str("payment_draft_template", DEFAULT_DRAFT_TEMPLATE),
    bankDetails: str("company_bank_details", DEFAULT_BANK_DETAILS),
    instruction: str("payment_draft_instruction", DEFAULT_DRAFT_INSTRUCTION),
    whatsappEnabled: map.get("whatsapp_enabled") === true,
  };
}

/** Super Admin: update the draft template / bank details / instruction / WhatsApp flag. */
export async function setDraftConfig(
  actor: Actor,
  update: { template?: string; bankDetails?: string; instruction?: string; whatsappEnabled?: boolean },
): Promise<void> {
  requirePermission(actor, "config:write");
  const entries: { key: string; value: string | boolean; description: string }[] = [];
  if (update.template !== undefined) entries.push({ key: "payment_draft_template", value: update.template, description: "Payment-draft message body ({{placeholder}} syntax)." });
  if (update.bankDetails !== undefined) entries.push({ key: "company_bank_details", value: update.bankDetails, description: "Company bank / payment details shown in the payment draft." });
  if (update.instruction !== undefined) entries.push({ key: "payment_draft_instruction", value: update.instruction, description: "Instruction to share the payment screenshot + Transaction ID." });
  if (update.whatsappEnabled !== undefined) entries.push({ key: "whatsapp_enabled", value: update.whatsappEnabled, description: "Feature flag: show a wa.me WhatsApp send link on the draft." });

  await db.$transaction(async (tx) => {
    for (const e of entries) {
      const prev = await tx.systemConfig.findUnique({ where: { key: e.key } });
      await tx.systemConfig.upsert({
        where: { key: e.key },
        update: { value: e.value, updatedBy: actor.userId },
        create: { key: e.key, value: e.value, description: e.description, updatedBy: actor.userId },
      });
      await writeAudit(tx, {
        entityType: "SystemConfig",
        entityId: e.key,
        action: "UPDATE",
        changes: [{ field: e.key, oldValue: prev?.value ?? null, newValue: typeof e.value === "boolean" ? e.value : "updated" }],
        actor,
      });
    }
  });
}

/** The exact list of what blocks draft generation (FR-SAL-13/27). Empty = allowed. */
export async function draftGenerationBlockers(leadId: string, actor: Actor): Promise<string[]> {
  const lead = await getLeadForActor(actor, leadId);
  const blockers = missingBasicFields(lead);
  if (!lead.enrollment?.standardFee) {
    blockers.push("Program & plan selection");
  }
  if (lead.enrollment?.concessionStatus === ConcessionStatus.PENDING_APPROVAL) {
    blockers.push("Concession approval");
  }
  return blockers;
}

export interface GeneratedDraft {
  version: number;
  content: string;
  generatedAt: string;
}

/**
 * Generate (or regenerate) the payment draft. Locks the fee on first generation; a later
 * call creates a new version from the current locked snapshot.
 */
export async function generateDraft(actor: Actor, leadId: string): Promise<GeneratedDraft> {
  const blockers = await draftGenerationBlockers(leadId, actor);
  if (blockers.length > 0) {
    throw new DraftError(
      `The payment draft can't be generated yet. Please complete: ${blockers.join(", ")}.`,
    );
  }

  const lead = await getLeadForActor(actor, leadId);
  const enrollment = lead.enrollment;
  if (!enrollment) throw new LeadError("Select a program and plan first.");

  // Lock the fee on first generation (Phase 3). Regeneration reuses the locked snapshot.
  if (!enrollment.feeLockedAt) {
    await lockFee(enrollment.id, actor);
  }

  // Re-read the (now locked) enrollment for the authoritative snapshot + schedule.
  const locked = await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
  const scheduleRaw = Array.isArray(locked.paymentSchedule) ? (locked.paymentSchedule as unknown[]) : [];
  const schedule = scheduleRaw.map((s) => {
    const row = s as { number: number; amount: string; dueDate: string };
    return { number: row.number, amount: row.amount, dueDate: row.dueDate };
  });

  const config = await getDraftConfig();
  const ctx = buildDraftContext({
    lead,
    enrollment: {
      program: locked.program,
      plan: locked.plan,
      comboMode: locked.comboMode,
      commencingDate: locked.commencingDate,
      standardFee: locked.standardFee?.toFixed(2) ?? "0",
      concessionAmount: locked.concessionAmount.toFixed(2),
      concessionStatus: locked.concessionStatus,
      finalApprovedFee: locked.finalApprovedFee?.toFixed(2) ?? "0",
    },
    schedule,
    bankDetails: config.bankDetails,
    instruction: config.instruction,
  });
  const content = renderTemplate(config.template, ctx);

  const result = await db.$transaction(async (tx) => {
    const last = await tx.paymentDraft.findFirst({
      where: { enrollmentId: enrollment.id },
      orderBy: { version: "desc" },
    });
    const version = (last?.version ?? 0) + 1;
    const draft = await tx.paymentDraft.create({
      data: {
        enrollmentId: enrollment.id,
        version,
        draftContent: content,
        draftSnapshot: ctx,
        generatedBy: actor.userId,
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: enrollment.id,
      action: version === 1 ? "DRAFT_GENERATE" : "DRAFT_REGENERATE",
      changes: [{ field: "draftVersion", oldValue: last?.version ?? null, newValue: version }],
      actor,
    });
    await advanceLeadStatus(tx, leadId, actor);
    return draft;
  });

  return { version: result.version, content, generatedAt: result.generatedAt.toISOString() };
}

/** All draft versions for a lead's enrollment (newest first) — the version history. */
export async function listDraftVersions(actor: Actor, leadId: string) {
  const lead = await getLeadForActor(actor, leadId);
  if (!lead.enrollment) return [];
  const drafts = await db.paymentDraft.findMany({
    where: { enrollmentId: lead.enrollment.id },
    orderBy: { version: "desc" },
  });
  const authorIds = [...new Set(drafts.map((d) => d.generatedBy))];
  const authors = await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } });
  const nameOf = new Map(authors.map((a) => [a.id, a.name]));
  return drafts.map((d) => ({
    version: d.version,
    content: d.draftContent,
    generatedAt: d.generatedAt.toISOString(),
    generatedByName: nameOf.get(d.generatedBy) ?? "Unknown",
  }));
}

/** A single draft version's content (for PDF/email). Ownership enforced. */
export async function getDraftVersion(actor: Actor, leadId: string, version?: number) {
  const lead = await getLeadForActor(actor, leadId);
  if (!lead.enrollment) throw new DraftError("No draft exists for this lead.");
  const draft = await db.paymentDraft.findFirst({
    where: { enrollmentId: lead.enrollment.id, ...(version ? { version } : {}) },
    orderBy: { version: "desc" },
  });
  if (!draft) throw new DraftError("No draft exists for this lead.");
  return { version: draft.version, content: draft.draftContent, learnerName: lead.fullName, learnerEmail: lead.email };
}

/** Send the latest draft to the learner's email via the NotificationProvider (FR-SAL-34). */
export async function emailDraft(actor: Actor, leadId: string): Promise<void> {
  const draft = await getDraftVersion(actor, leadId);
  if (!draft.learnerEmail) throw new DraftError("This lead has no email address on file.");
  const { sendEmail } = await import("@/server/notifications");
  await sendEmail({
    to: draft.learnerEmail,
    subject: "Your ProITbridge enrollment & payment details",
    body: draft.content,
  });
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { enrollment: true } });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: lead.enrollment!.id,
      action: "DRAFT_EMAILED",
      changes: [{ field: "draftVersion", oldValue: null, newValue: draft.version }],
      actor,
    });
  });
}

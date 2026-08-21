/**
 * Public "self-intake link" (FR-SAL — capture assist). A salesperson mints a single-use,
 * 7-day, unguessable link and shares it; the prospective learner opens it with NO login and
 * fills their own basic details on a PUBLIC form. On submit a NEW lead is created, owned by
 * the inviting salesperson, with a complete record. Mirrors the password-reset token flow
 * (src/server/services/auth.ts): only the SHA-256 hash is stored; the raw token lives only in
 * the shared link; single-use via `usedAt`; time-limited via `expiresAt`. Touches NO money /
 * payment / audit-decision path — the salesperson still captures payment separately.
 */
import "server-only";
import { createHash, randomInt } from "node:crypto";
import { Program, Plan, PaymentMethod, UserStatus, LeadStatus, type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { checkDuplicate, advanceLeadStatus, getLeadForActor } from "@/server/services/leads";
import { stageProof, capturePayment, type UploadedProof } from "@/server/services/payments";
import { calculateFee } from "@/server/services/pricing";
import { notifyUser } from "@/server/notifications";
import { INTAKE_LINK } from "@/lib/constants";

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function appOrigin(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export interface CreatedInvite {
  url: string;
  expiresAt: Date;
}

/** A salesperson mints a single-use, 7-day link the lead will self-fill. */
export async function createIntakeInvite(actor: Actor, note?: string): Promise<CreatedInvite> {
  requirePermission(actor, "lead:create");
  const raw = createHash("sha256").update(`${actor.userId}:${Date.now()}:${randomInt(1e9)}`).digest("hex");
  const expiresAt = new Date(Date.now() + INTAKE_LINK.TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.leadIntakeInvite.create({
    data: { salespersonId: actor.userId, tokenHash: sha256(raw), note: note?.trim() || null, expiresAt },
  });
  return { url: `${appOrigin()}/intake/${raw}`, expiresAt };
}

/** Public: is this token still usable? Returns only a boolean — no record data ever leaks. */
export async function isIntakeTokenValid(rawToken: string): Promise<boolean> {
  const invite = await db.leadIntakeInvite.findUnique({ where: { tokenHash: sha256(rawToken) } });
  return Boolean(invite && !invite.usedAt && invite.expiresAt.getTime() > Date.now());
}

export interface IntakeData {
  fullName: string; dob: string; doorNo: string; street: string; address: string;
  district: string; state: string; pincode: string; email: string; mobile: string;
  interestedProgram: Program; interestedPlan: Plan;
}
export type IntakeResult = { ok: true } | { ok: false; error: string };

/**
 * Public: the lead submits their details against a valid token → a NEW lead owned by the
 * inviting salesperson, with a complete record. Single-use: consumes the token in the same
 * transaction. The audit write is attributed to the owning salesperson (there is no lead-user).
 */
export async function submitIntake(
  rawToken: string,
  data: IntakeData,
  ip?: string | null,
  proofs?: { bytes: Uint8Array; originalFilename: string }[],
): Promise<IntakeResult> {
  const invite = await db.leadIntakeInvite.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This link is invalid or has already been used." };
  }
  const sp = await db.user.findUnique({ where: { id: invite.salespersonId } });
  if (!sp || sp.status !== UserStatus.ACTIVE) {
    return { ok: false, error: "This link is no longer active. Please contact your ProITbridge advisor." };
  }
  const actor: Actor = { userId: sp.id, role: sp.role };

  // Duplicate-active-lead guard (FR-SAL-10), before creating.
  for (const field of ["mobile", "email"] as const) {
    const dup = await checkDuplicate(field, data[field]);
    if (dup) return { ok: false, error: `A record with this ${field} already exists. Please contact your advisor.` };
  }

  // Stage any lead-uploaded payment proofs BEFORE the txn (external storage/scan/OCR I/O). A
  // bad file is skipped rather than failing the whole submission. NOT captured as a payment —
  // held for the salesperson to confirm (BR-20) once the fee is locked.
  const staged: UploadedProof[] = [];
  for (const p of proofs ?? []) {
    try {
      staged.push(await stageProof(actor, p));
    } catch {
      /* skip an unreadable / rejected file */
    }
  }

  // Price the lead's own course choice up front (a Pricing Master read, so outside the txn).
  // If no effective price exists for that program/plan the lead is still created — the
  // salesperson just picks the course by hand, exactly as before.
  let quote: Awaited<ReturnType<typeof calculateFee>> | null = null;
  try {
    quote = await calculateFee({ program: data.interestedProgram, plan: data.interestedPlan, comboMode: null });
  } catch {
    quote = null;
  }

  let newLeadId = "";
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        fullName: data.fullName.trim(),
        dob: new Date(data.dob),
        doorNo: data.doorNo.trim(),
        street: data.street.trim(),
        address: data.address.trim(),
        district: data.district.trim(),
        state: data.state.trim(),
        pincode: data.pincode.trim(),
        email: data.email.trim().toLowerCase(),
        mobile: data.mobile.trim(),
        interestedProgram: data.interestedProgram,
        interestedPlan: data.interestedPlan,
        leadSource: "Self-intake link",
        salespersonId: sp.id,
        status: LeadStatus.NEW_LEAD,
      },
    });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: lead.id,
      action: "CREATE",
      changes: [{ field: "status", oldValue: null, newValue: LeadStatus.NEW_LEAD }],
      actor,
      ip,
    });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: lead.id,
      action: "SELF_INTAKE_SUBMITTED",
      changes: [{ field: "basicDetails", oldValue: null, newValue: "self-filled by lead via intake link" }],
      actor,
      ip,
    });
    for (const s of staged) {
      await tx.leadSelfProof.create({
        data: {
          leadId: lead.id,
          storageKey: s.key,
          checksumSha256: s.checksum,
          fileType: s.fileType,
          fileSize: s.fileSize,
          originalFilename: s.originalFilename,
          ocrFields: s.ocr.fields as Prisma.InputJsonValue,
          ocrConfidence: s.ocr.confidence as Prisma.InputJsonValue,
          ipAddress: ip ?? null,
        },
      });
    }
    // Price the enrollment straight from the program + plan the lead chose (both mandatory
    // on the intake form), so the salesperson does not have to re-select the course before
    // confirming a payment. The fee is deliberately left UNLOCKED — the salesperson can
    // still correct the course right up until the first payment is approved.
    if (quote) {
      await tx.enrollment.create({
        data: {
          leadId: lead.id,
          program: data.interestedProgram,
          plan: data.interestedPlan,
          pricingId: quote.pricingId,
          standardFee: quote.standardFee.toFixed(2),
          baseFee: quote.baseFee.toFixed(2),
          gstAmount: quote.gstAmount.toFixed(2),
          gstPercent: quote.gstPercent.toFixed(2),
          finalApprovedFee: quote.standardFee.toFixed(2),
        },
      });
      await writeAudit(tx, {
        entityType: "Lead",
        entityId: lead.id,
        action: "SELECT_COURSE",
        changes: [
          { field: "program", oldValue: null, newValue: data.interestedProgram },
          { field: "plan", oldValue: null, newValue: data.interestedPlan },
          { field: "standardFee", oldValue: null, newValue: quote.standardFee.toFixed(2) },
          { field: "source", oldValue: null, newValue: "auto-priced from the lead's own intake selection" },
        ],
        actor,
        ip,
      });
    }

    await tx.leadIntakeInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), createdLeadId: lead.id, ipAddress: ip ?? null },
    });
    await advanceLeadStatus(tx, lead.id, actor);
    newLeadId = lead.id;
  });

  await db.securityEvent.create({ data: { eventType: "LEAD_INTAKE_SUBMITTED", userId: sp.id, ipAddress: ip ?? null } });

  // Tell the owning salesperson their lead self-filled (and whether a payment proof came in).
  const proofNote = staged.length ? ` and attached ${staged.length} payment proof${staged.length > 1 ? "s" : ""} to confirm` : "";
  await notifyUser({
    recipientId: sp.id,
    type: "LEAD_SELF_INTAKE",
    subject: "A lead completed your intake form",
    body: `${data.fullName.trim()} filled their enrollment details via your intake link${proofNote}.`,
    relatedEntityType: "Lead",
    relatedEntityId: newLeadId,
  });
  return { ok: true };
}

// ── Salesperson-side: review + confirm the lead's uploaded payment proof(s) ───────

export interface HeldProof {
  id: string;
  originalFilename: string | null;
  fileType: string;
  createdAt: string;
  ocr: { receivedAmount?: string; paymentDate?: string; transactionId?: string; paymentMethod?: string; payerName?: string };
}

/** Owner-scoped load of a held proof's storage descriptor (for the in-app image preview). */
export async function getSelfProofForActor(actor: Actor, selfProofId: string): Promise<{ storageKey: string; fileType: string } | null> {
  const held = await db.leadSelfProof.findUnique({ where: { id: selfProofId } });
  if (!held) return null;
  await getLeadForActor(actor, held.leadId); // ownership — throws if not permitted
  return { storageKey: held.storageKey, fileType: held.fileType };
}

/** List the lead's not-yet-confirmed self-uploaded payment proofs (owner-scoped). */
export async function listSelfProofs(actor: Actor, leadId: string): Promise<HeldProof[]> {
  await getLeadForActor(actor, leadId); // ownership
  const rows = await db.leadSelfProof.findMany({
    where: { leadId, consumedPaymentId: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    originalFilename: r.originalFilename,
    fileType: r.fileType,
    createdAt: r.createdAt.toISOString(),
    ocr: (r.ocrFields as HeldProof["ocr"]) ?? {},
  }));
}

export interface ConfirmProofInput {
  receivedAmount: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  transactionId: string;
  confirmations: Record<"receivedAmount" | "paymentDate" | "transactionId" | "paymentMethod", boolean>;
  varianceReason?: string;
}

/**
 * The salesperson confirms a held (lead-uploaded) proof into a real Payment — the BR-20 human
 * check. Requires the enrollment fee to be locked first (generateDraft), exactly like a normal
 * capture. The held proof is already staged, so capturePayment reuses its key + OCR sidecar.
 */
export async function confirmSelfProof(actor: Actor, leadId: string, selfProofId: string, input: ConfirmProofInput) {
  await getLeadForActor(actor, leadId); // ownership
  const held = await db.leadSelfProof.findUnique({ where: { id: selfProofId } });
  if (!held || held.leadId !== leadId || held.consumedPaymentId) {
    throw new Error("That payment proof is no longer available.");
  }
  const result = await capturePayment(actor, leadId, {
    proof: {
      key: held.storageKey,
      checksum: held.checksumSha256,
      fileType: held.fileType,
      fileSize: held.fileSize,
      originalFilename: held.originalFilename ?? "learner-proof",
    },
    receivedAmount: input.receivedAmount,
    paymentDate: input.paymentDate,
    paymentMethod: input.paymentMethod,
    transactionId: input.transactionId,
    confirmations: input.confirmations,
    varianceReason: input.varianceReason,
    manualEntryNoOcr: false,
  });
  await db.leadSelfProof.update({ where: { id: held.id }, data: { consumedPaymentId: result.paymentId } });
  return result;
}

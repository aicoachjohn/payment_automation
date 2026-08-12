/**
 * Payment capture with proof upload + OCR assist (FR-SAL-38..48, FR-SEC-20..26,
 * BR-05/06/07/20). Extraction gives the speed; MANDATORY per-field human confirmation
 * keeps it safe — no unconfirmed auto-extracted value ever reaches Nandhiya (BR-20).
 * Payment number/type/expected are SYSTEM-derived; balance is never stored (BR-22).
 */
import "server-only";
import { createHash } from "node:crypto";
import { AuditStatus, PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { getLeadForActor, advanceLeadStatus } from "@/server/services/leads";
import { getConfigNumber } from "@/server/services/system-config";
import { round, eq, calculateBalance, type MoneyInput } from "@/server/money";
import { derivePaymentType, expectedAmountFor, clearsBalance } from "@/server/services/payment-rules";
import { runOcr, type OcrFields } from "@/server/ocr";
import { validateProofFile } from "@/server/storage/validate";
import { getScanProvider } from "@/server/storage/scan";
import {
  getStorageProvider, newProofKey, signProofToken, type StorageProvider,
} from "@/server/storage";

export class PaymentError extends Error {
  readonly code = "PAYMENT_ERROR";
}

const OCR_FIELDS = ["receivedAmount", "paymentDate", "transactionId", "paymentMethod"] as const;
type OcrFieldKey = (typeof OCR_FIELDS)[number];
const PROOF_URL_TTL_MS = 5 * 60_000; // 5 minutes

function sidecarKey(key: string): string {
  return `${key}.ocr.json`;
}

// ── Upload: validate → scan → store → OCR (FR-SAL-39, FR-SEC-22/23/24) ────────

export interface UploadedProof {
  key: string;
  checksum: string;
  fileType: string;
  fileSize: number;
  originalFilename: string;
  ocr: { ok: boolean; fields: OcrFields; confidence: Record<string, number> };
}

export async function uploadProof(
  actor: Actor,
  leadId: string,
  file: { bytes: Uint8Array; originalFilename: string },
): Promise<UploadedProof> {
  await getLeadForActor(actor, leadId); // ownership
  requirePermission(actor, "payment:create");

  const maxMb = await getConfigNumber("max_upload_mb", 10);
  const validation = validateProofFile(file.bytes, maxMb * 1024 * 1024);
  if (!validation.ok || !validation.type) throw new PaymentError(validation.error ?? "Invalid file.");

  const scan = await getScanProvider().scan(file.bytes);
  if (!scan.clean) throw new PaymentError("This file did not pass the malware scan and was rejected.");

  const storage: StorageProvider = getStorageProvider();
  const key = newProofKey();
  await storage.put(key, file.bytes, validation.type);

  const ocr = await runOcr(file.bytes, validation.type);
  await storage.putJson(sidecarKey(key), { fields: ocr.fields, confidence: ocr.confidence, raw: ocr.raw });

  return {
    key,
    checksum: createHash("sha256").update(file.bytes).digest("hex"),
    fileType: validation.type,
    fileSize: file.bytes.length,
    originalFilename: file.originalFilename.slice(0, 255),
    ocr: { ok: ocr.ok, fields: ocr.fields, confidence: ocr.confidence },
  };
}

// ── Capture: confirm → validate → create Payment + PaymentProof ───────────────

export interface CaptureInput {
  proof: { key: string; checksum: string; fileType: string; fileSize: number; originalFilename: string };
  receivedAmount: string;
  paymentDate: string; // ISO — the date ON the proof, not upload date
  paymentMethod: PaymentMethod;
  transactionId: string;
  confirmations: Record<OcrFieldKey, boolean>;
  varianceReason?: string;
  manualEntryNoOcr: boolean;
}

function sameValue(field: OcrFieldKey, extracted: string | undefined, final: string): boolean {
  if (extracted == null) return false;
  if (field === "receivedAmount") return eq(extracted, final);
  if (field === "paymentDate") return extracted.slice(0, 10) === final.slice(0, 10);
  if (field === "transactionId") return extracted.replace(/\s+/g, "").toUpperCase() === final.replace(/\s+/g, "").toUpperCase();
  return extracted === final;
}

export async function capturePayment(actor: Actor, leadId: string, input: CaptureInput): Promise<{ paymentId: string; paymentNumber: number }> {
  const lead = await getLeadForActor(actor, leadId);
  requirePermission(actor, "payment:create");
  const enrollment = lead.enrollment;
  if (!enrollment?.finalApprovedFee) throw new PaymentError("Generate the payment draft (which locks the fee) before recording a payment.");

  // Both proof AND Transaction ID are mandatory (FR-SAL-38, BR-05).
  if (!input.proof?.key) throw new PaymentError("A payment proof upload is required.");
  if (!input.transactionId?.trim()) throw new PaymentError("The Transaction ID is required.");

  // The SERVER's record of what OCR extracted (from storage, not the client).
  const sidecar = await getStorageProvider().getJson<{ fields: OcrFields; confidence: Record<string, number>; raw: unknown }>(sidecarKey(input.proof.key));
  const extracted = sidecar?.fields ?? {};

  const finals: Record<OcrFieldKey, string> = {
    receivedAmount: input.receivedAmount,
    paymentDate: input.paymentDate,
    transactionId: input.transactionId,
    paymentMethod: input.paymentMethod,
  };

  // Mandatory per-field confirmation of every OCR-extracted value (BR-20, FR-SAL-40).
  const fieldSources: Record<string, "OCR" | "MANUAL"> = {};
  for (const field of OCR_FIELDS) {
    const extractedValue = extracted[field] != null ? String(extracted[field]) : undefined;
    if (extractedValue !== undefined && input.confirmations[field] !== true) {
      throw new PaymentError(`Please confirm the extracted ${field.replace(/([A-Z])/g, " $1").toLowerCase()} before submitting.`);
    }
    fieldSources[field] = sameValue(field, extractedValue, finals[field]) ? "OCR" : "MANUAL";
  }

  // System-derived number / expected / type; balance from APPROVED payments only.
  const existing = await db.payment.findMany({ where: { enrollmentId: enrollment.id, voided: false } });
  const paymentNumber = existing.length + 1;
  const outstanding = calculateBalance(
    enrollment.finalApprovedFee,
    existing.map((p) => ({ receivedAmount: p.receivedAmount.toString(), auditStatus: p.auditStatus, voided: p.voided })),
  );
  const schedule = Array.isArray(enrollment.paymentSchedule)
    ? (enrollment.paymentSchedule as { number: number; amount: string }[])
    : [];
  const expectedAmount = expectedAmountFor(schedule, paymentNumber, outstanding);
  const bringsToZero = clearsBalance(outstanding, input.receivedAmount);
  const paymentType = derivePaymentType(paymentNumber, enrollment.courseStartedFlag, bringsToZero);

  // Variance: warn-not-block, but a reason is mandatory when it differs (FR-SAL-44).
  const hasVariance = !eq(expectedAmount, input.receivedAmount);
  if (hasVariance && !input.varianceReason?.trim()) {
    throw new PaymentError("The received amount differs from the expected amount — a reason is required.");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          enrollmentId: enrollment.id,
          paymentNumber,
          paymentType,
          expectedAmount: expectedAmount.toFixed(2),
          receivedAmount: round(input.receivedAmount).toFixed(2),
          paymentDate: new Date(input.paymentDate),
          paymentMethod: input.paymentMethod,
          transactionId: input.transactionId.trim(),
          auditStatus: AuditStatus.PENDING_AUDIT,
          submittedBy: actor.userId,
          manualEntryNoOcr: input.manualEntryNoOcr,
          fieldSources,
          varianceReason: hasVariance ? input.varianceReason!.trim() : null,
        },
      });
      await tx.paymentProof.create({
        data: {
          paymentId: payment.id,
          version: 1,
          filePath: input.proof.key,
          fileType: input.proof.fileType,
          fileSize: input.proof.fileSize,
          uploadedBy: actor.userId,
          checksumSha256: input.proof.checksum,
          originalFilename: input.proof.originalFilename,
          virusScanStatus: "CLEAN",
          ocrRawOutput: (sidecar?.raw ?? undefined) as Prisma.InputJsonValue,
        },
      });
      await writeAudit(tx, {
        entityType: "Payment",
        entityId: payment.id,
        action: "PAYMENT_SUBMIT",
        changes: [
          { field: "paymentNumber", oldValue: null, newValue: paymentNumber },
          { field: "paymentType", oldValue: null, newValue: paymentType },
          { field: "auditStatus", oldValue: null, newValue: AuditStatus.PENDING_AUDIT },
        ],
        actor,
      });
      await advanceLeadStatus(tx, leadId, actor);
      return payment;
    });
    return { paymentId: result.id, paymentNumber };
  } catch (e) {
    // Duplicate Transaction ID → name the conflicting lead + payment (FR-SAL-43, BR-06).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const clash = await db.payment.findUnique({
        where: { transactionId: input.transactionId.trim() },
        include: { enrollment: { include: { lead: true } } },
      });
      if (clash) {
        throw new PaymentError(
          `That Transaction ID is already recorded on lead "${clash.enrollment.lead.fullName}" (payment #${clash.paymentNumber}).`,
        );
      }
      throw new PaymentError("That Transaction ID is already recorded in the system.");
    }
    throw e;
  }
}

// ── Proof access: ownership + short-lived signed token (FR-SEC-21/25) ──────────

export async function getProofForActor(actor: Actor, proofId: string) {
  const proof = await db.paymentProof.findUnique({
    where: { id: proofId },
    include: { payment: { include: { enrollment: { include: { lead: true } } } } },
  });
  if (!proof) return null;
  // Ownership: salesperson → own lead; managers/auditor/finance/admin → all.
  const { requireRecordAccess } = await import("@/server/auth/permissions");
  requireRecordAccess(actor, proof.payment.enrollment.lead);
  return proof;
}

/** Issue a short-lived signed URL AFTER verifying role + record access (FR-SEC-21). */
export async function issueProofUrl(actor: Actor, proofId: string): Promise<string> {
  const proof = await getProofForActor(actor, proofId);
  if (!proof) throw new PaymentError("Proof not found.");
  const token = signProofToken(proof.id, Date.now() + PROOF_URL_TTL_MS);
  await db.securityEvent.create({
    data: { eventType: "PROOF_URL_ISSUED", userId: actor.userId, details: { proofId: proof.id } },
  });
  return `/api/proofs/${proof.id}?token=${token}`;
}

export async function logProofAccess(proofId: string, actorId: string, action: string): Promise<void> {
  await db.securityEvent.create({ data: { eventType: action, userId: actorId, details: { proofId } } });
}

/** Read the proof bytes from storage (used by the /api/proofs route after auth). */
export async function readProofBytes(filePath: string): Promise<Uint8Array> {
  return getStorageProvider().get(filePath);
}

// ── Replace a proof during a correction cycle → NEW version, v1 retained ──────

export async function replaceProof(
  actor: Actor,
  paymentId: string,
  file: { bytes: Uint8Array; originalFilename: string },
): Promise<{ version: number }> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { enrollment: { include: { lead: true } }, proofs: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!payment) throw new PaymentError("Payment not found.");
  const { requireRecordAccess } = await import("@/server/auth/permissions");
  requireRecordAccess(actor, payment.enrollment.lead);
  requirePermission(actor, "payment:create");

  const maxMb = await getConfigNumber("max_upload_mb", 10);
  const validation = validateProofFile(file.bytes, maxMb * 1024 * 1024);
  if (!validation.ok || !validation.type) throw new PaymentError(validation.error ?? "Invalid file.");
  const scan = await getScanProvider().scan(file.bytes);
  if (!scan.clean) throw new PaymentError("This file did not pass the malware scan and was rejected.");

  const key = newProofKey();
  await getStorageProvider().put(key, file.bytes, validation.type);
  const nextVersion = (payment.proofs[0]?.version ?? 0) + 1;

  await db.$transaction(async (tx) => {
    await tx.paymentProof.create({
      data: {
        paymentId,
        version: nextVersion,
        filePath: key,
        fileType: validation.type!,
        fileSize: file.bytes.length,
        uploadedBy: actor.userId,
        checksumSha256: createHash("sha256").update(file.bytes).digest("hex"),
        originalFilename: file.originalFilename.slice(0, 255),
        virusScanStatus: "CLEAN",
      },
    });
    await writeAudit(tx, {
      entityType: "Payment",
      entityId: paymentId,
      action: "PROOF_REPLACE",
      changes: [{ field: "proofVersion", oldValue: payment.proofs[0]?.version ?? null, newValue: nextVersion }],
      actor,
    });
  });
  return { version: nextVersion };
}

/** Payments recorded on a lead's enrollment (for the sales lead page). */
export async function listPaymentsForLead(actor: Actor, leadId: string) {
  const lead = await getLeadForActor(actor, leadId);
  if (!lead.enrollment) return { payments: [], balance: "0.00", finalApprovedFee: null as string | null };
  const payments = await db.payment.findMany({
    where: { enrollmentId: lead.enrollment.id, voided: false },
    orderBy: { paymentNumber: "asc" },
    include: { proofs: { orderBy: { version: "desc" } } },
  });
  const balance = calculateBalance(
    lead.enrollment.finalApprovedFee ?? "0",
    payments.map((p) => ({ receivedAmount: p.receivedAmount.toString(), auditStatus: p.auditStatus, voided: p.voided })),
  );
  return {
    finalApprovedFee: lead.enrollment.finalApprovedFee?.toFixed(2) ?? null,
    balance: balance.toFixed(2),
    payments: payments.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      paymentType: p.paymentType,
      expectedAmount: p.expectedAmount.toFixed(2),
      receivedAmount: p.receivedAmount.toFixed(2),
      paymentDate: p.paymentDate.toISOString(),
      paymentMethod: p.paymentMethod,
      transactionId: p.transactionId,
      auditStatus: p.auditStatus,
      manualEntryNoOcr: p.manualEntryNoOcr,
      varianceReason: p.varianceReason,
      proofId: p.proofs[0]?.id ?? null,
      proofVersions: p.proofs.length,
    })),
  };
}

export type { MoneyInput };

/**
 * Lead intake auto-fill (FR-SAL-08 assist). A salesperson can drop in a screenshot /
 * document or paste a message, and the system extracts the learner's contact details so
 * nothing is typed by hand. Assistive only — the extracted fields pre-fill the New Lead
 * form and the salesperson reviews + confirms before the lead is created. Reuses the same
 * upload validation, malware scan and OCR provider as payment proofs.
 */
import "server-only";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { validateProofFile } from "@/server/storage/validate";
import { getScanProvider } from "@/server/storage/scan";
import { getOcrProvider, parseLeadText, type LeadOcrFields } from "@/server/ocr";
import { getConfigNumber } from "@/server/services/system-config";

export class LeadIntakeError extends Error {
  readonly code = "LEAD_INTAKE_ERROR";
}

export interface LeadExtractResult {
  ok: boolean; // true when at least one usable field (name / mobile / email) was found
  fields: LeadOcrFields;
}

/** Extract lead contact fields from an uploaded screenshot / document. */
export async function extractLeadFromUpload(
  actor: Actor,
  file: { bytes: Uint8Array; originalFilename: string },
): Promise<LeadExtractResult> {
  requirePermission(actor, "lead:create");

  const maxMb = await getConfigNumber("max_upload_mb", 10);
  const validation = validateProofFile(file.bytes, maxMb * 1024 * 1024);
  if (!validation.ok || !validation.type) {
    throw new LeadIntakeError(validation.error ?? "Unsupported file. Upload a JPG, PNG or PDF under the size limit.");
  }
  const scan = await getScanProvider().scan(file.bytes);
  if (!scan.clean) throw new LeadIntakeError("This file did not pass the malware scan and was rejected.");

  let text = "";
  try {
    const result = await getOcrProvider().extract(file.bytes, validation.type);
    text = result.text ?? "";
  } catch {
    text = ""; // OCR failed/timed out → fall back to manual entry (FR-SAL-47)
  }
  const fields = parseLeadText(text);
  return { ok: Boolean(fields.fullName || fields.mobile || fields.email), fields };
}

/** Parse lead fields from pasted text (a WhatsApp message, enquiry note, …). */
export function extractLeadFromText(actor: Actor, text: string): LeadExtractResult {
  requirePermission(actor, "lead:create");
  const fields = parseLeadText(text);
  return { ok: Boolean(fields.fullName || fields.mobile || fields.email), fields };
}

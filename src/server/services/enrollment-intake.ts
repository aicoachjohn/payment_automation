/**
 * One-bundle enrollment intake (hands-free capture). The sales team uploads only three
 * things — the "Enrollment Confirmation" message text and one or more payment proofs — and
 * the tool assembles the whole record: Lead → basic details → Enrollment (program/plan/fee)
 * → payment draft (fee lock) → one Payment per proof (each PENDING_AUDIT). Nothing is typed;
 * extraction is ASSISTIVE and the salesperson confirms every field on one review screen
 * (BR-20). This service is a thin orchestration over the existing domain services — it adds
 * NO new business logic, money math or audit path; each reused step audits itself and money
 * stays Decimal / server-computed (the message's course fee is a cross-check only, rule #3).
 */
import "server-only";
import { ComboMode, PaymentMethod, Plan, Program } from "@prisma/client";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { eq } from "@/server/money";
import { parseEnrollmentText } from "@/server/ocr";
import { getConfigValue } from "@/server/services/system-config";
import { calculateFee } from "@/server/services/pricing";
import { createLead, updateBasicDetails, selectCourse, getLeadForActor } from "@/server/services/leads";
import { generateDraft } from "@/server/services/draft";
import {
  stageProof,
  capturePayment,
  PaymentError,
  type UploadedProof,
  type CaptureInput,
} from "@/server/services/payments";
import {
  classifyProgram,
  splitAddress,
  DEFAULT_PROGRAM_KEYWORDS,
  type ProgramKeywordMap,
} from "@/server/services/enrollment-mapping";

export class EnrollmentIntakeError extends Error {
  readonly code = "ENROLLMENT_INTAKE_ERROR";
}

// ── Extract (assistive preview — NO writes to lead/enrollment/payment) ─────────

export interface StagedPaymentPreview {
  proof: UploadedProof; // staged descriptor + OCR sidecar fields
  receivedAmount?: string;
  paymentDate?: string;
  transactionId?: string;
  paymentMethod?: PaymentMethod;
  payerName?: string;
}

export interface EnrollmentPreview {
  learner: {
    fullName?: string;
    dob?: string;
    doorNo: string;
    street: string;
    address: string;
    district: string;
    state: string;
    pincode?: string;
    email?: string;
    mobile?: string;
  };
  course: {
    program?: Program;
    plan?: Plan;
    comboMode?: ComboMode | null;
    programName?: string;
    commencingDate?: string;
    textCourseFee?: string; // from the message — cross-check ONLY (rule #3)
    systemFee?: string; // from Pricing Master — authoritative, undefined if unresolved
    feeMismatch: boolean;
  };
  payments: StagedPaymentPreview[];
  warnings: string[];
}

/** Read the config-driven program keyword map (rule #10), falling back to the default. */
async function loadProgramKeywords(): Promise<ProgramKeywordMap> {
  const raw = await getConfigValue("enrollment_program_map");
  if (raw && typeof raw === "object") {
    const map: ProgramKeywordMap = {};
    for (const [word, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" && value in Program) {
        map[word.toLowerCase()] = Program[value as keyof typeof Program];
      }
    }
    if (Object.keys(map).length > 0) return map;
  }
  return DEFAULT_PROGRAM_KEYWORDS;
}

/**
 * Resolve the Pricing-Master fee for a program/plan, inferring COMBO comboMode by matching
 * the text's course fee against each mode's fee. Returns the authoritative system fee and
 * the chosen comboMode (or null for non-combo, undefined when it can't be inferred).
 */
async function resolveSystemFee(
  program: Program | undefined,
  plan: Plan | undefined,
  textCourseFee: string | undefined,
  warnings: string[],
): Promise<{ systemFee?: string; comboMode?: ComboMode | null }> {
  if (!program || !plan) return { comboMode: null };

  if (program !== Program.COMBO_ALL_THREE) {
    try {
      const quote = await calculateFee({ program, plan, comboMode: null });
      return { systemFee: quote.standardFee.toFixed(2), comboMode: null };
    } catch {
      warnings.push("No active Pricing Master row for this program/plan — pick the fee source on review.");
      return { comboMode: null };
    }
  }

  // COMBO: try both modes; prefer the one whose fee matches the message's course fee.
  const quotes: { mode: ComboMode; fee: string }[] = [];
  for (const mode of [ComboMode.SINGLE_SHOT, ComboMode.DOUBLE_SHOT]) {
    try {
      const quote = await calculateFee({ program, plan, comboMode: mode });
      quotes.push({ mode, fee: quote.standardFee.toFixed(2) });
    } catch {
      /* mode not priced — skip */
    }
  }
  if (quotes.length === 0) {
    warnings.push("No active Pricing Master row for this Combo plan — pick the mode on review.");
    return { comboMode: undefined };
  }
  const matched = textCourseFee ? quotes.find((q) => eq(q.fee, textCourseFee)) : undefined;
  if (matched) return { systemFee: matched.fee, comboMode: matched.mode };
  // No fee match → leave the mode for the salesperson to choose; show one fee for reference.
  warnings.push("Couldn't tell Single-Shot from Double-Shot from the message — choose the mode on review.");
  return { systemFee: quotes[0].fee, comboMode: undefined };
}

/**
 * Stage payment proofs (validate → scan → store → OCR) into review-ready items — persists
 * each file + its OCR sidecar but creates NO lead/payment. Used by the initial extract AND by
 * the review screen's "Add payment proof(s)" control (when the salesperson forgot one).
 */
export async function stagePaymentProofs(
  actor: Actor,
  proofs: { bytes: Uint8Array; originalFilename: string }[],
): Promise<StagedPaymentPreview[]> {
  requirePermission(actor, "payment:create");
  const out: StagedPaymentPreview[] = [];
  for (const file of proofs) {
    const proof = await stageProof(actor, file);
    out.push({
      proof,
      receivedAmount: proof.ocr.fields.receivedAmount,
      paymentDate: proof.ocr.fields.paymentDate,
      transactionId: proof.ocr.fields.transactionId,
      paymentMethod: proof.ocr.fields.paymentMethod,
      payerName: proof.ocr.fields.payerName,
    });
  }
  return out;
}

export async function extractEnrollmentBundle(
  actor: Actor,
  input: { text: string; proofs: { bytes: Uint8Array; originalFilename: string }[] },
): Promise<EnrollmentPreview> {
  requirePermission(actor, "lead:create");
  requirePermission(actor, "payment:create");

  const warnings: string[] = [];
  const fields = parseEnrollmentText(input.text ?? "");
  const addr = splitAddress(fields.fullAddress);

  const program = classifyProgram(fields.programName, await loadProgramKeywords());
  const plan = fields.plan;
  const { systemFee, comboMode } = await resolveSystemFee(program, plan, fields.courseFee, warnings);
  const feeMismatch = Boolean(fields.courseFee && systemFee && !eq(fields.courseFee, systemFee));

  const payments = await stagePaymentProofs(actor, input.proofs ?? []);

  return {
    learner: {
      fullName: fields.fullName,
      dob: fields.dob,
      doorNo: addr.doorNo,
      street: addr.street,
      address: addr.address,
      district: addr.district,
      state: addr.state,
      pincode: fields.pincode,
      email: fields.email,
      mobile: fields.mobile,
    },
    course: {
      program,
      plan,
      comboMode,
      programName: fields.programName,
      commencingDate: fields.commencingDate,
      textCourseFee: fields.courseFee,
      systemFee,
      feeMismatch,
    },
    payments,
    warnings,
  };
}

// ── Commit (the reviewed + confirmed write path — a sequential saga) ───────────

export interface ReviewedPaymentInput {
  proof: { key: string; checksum: string; fileType: string; fileSize: number; originalFilename: string };
  receivedAmount: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  transactionId: string;
  confirmations: CaptureInput["confirmations"];
  varianceReason?: string;
  manualEntryNoOcr: boolean;
}

export interface ReviewedBundle {
  learner: {
    fullName: string;
    dob: string;
    doorNo: string;
    street: string;
    address: string;
    district: string;
    state: string;
    pincode: string;
    email: string;
    mobile: string;
    leadSource?: string;
    remarks?: string;
  };
  course: {
    program: Program;
    plan: Plan;
    comboMode?: ComboMode | null;
    commencingDate?: string | null;
  };
  payments: ReviewedPaymentInput[];
}

export interface CommitResult {
  leadId: string;
  enrollmentId: string;
  paymentIds: string[];
  warnings: string[];
}

/**
 * Create the whole enrollment from the reviewed bundle. NOT one giant transaction — each
 * reused step (createLead, updateBasicDetails, selectCourse, generateDraft, capturePayment)
 * runs its own audited transaction and, for proofs, external storage/scan I/O. Ordering is
 * fixed by real dependencies: the fee must be locked (generateDraft) before any payment can
 * be captured. If a later payment fails (e.g. a duplicate Transaction ID), the already-valid
 * lead/enrollment/earlier payments are NOT rolled back — they are correct domain state; the
 * failure is returned as a warning and the salesperson finishes on the lead page.
 */
/**
 * Shared fill steps for an EXISTING lead: basic details → course (fee from Pricing Master) →
 * draft (locks the fee) → one Payment per proof (each PENDING_AUDIT). Used by both the
 * create-from-upload (commit) and fill-existing-lead (apply) paths. A failed later payment is
 * a warning, not a rollback — earlier valid work stays. generateDraft MUST run before capture.
 */
async function fillLeadFromBundle(
  actor: Actor,
  leadId: string,
  input: ReviewedBundle,
  warnings: string[],
): Promise<{ enrollmentId: string; paymentIds: string[] }> {
  await updateBasicDetails(actor, leadId, {
    fullName: input.learner.fullName,
    dob: input.learner.dob,
    doorNo: input.learner.doorNo,
    street: input.learner.street,
    address: input.learner.address,
    district: input.learner.district,
    state: input.learner.state,
    pincode: input.learner.pincode,
    email: input.learner.email,
    mobile: input.learner.mobile,
    leadSource: input.learner.leadSource,
    remarks: input.learner.remarks,
  });

  await selectCourse(actor, leadId, {
    program: input.course.program,
    plan: input.course.plan,
    comboMode: input.course.comboMode ?? null,
    commencingDate: input.course.commencingDate ?? null,
  });

  await generateDraft(actor, leadId); // locks the fee + builds the schedule — before any capture

  const lead = await getLeadForActor(actor, leadId);
  const enrollmentId = lead.enrollment?.id;
  if (!enrollmentId) throw new EnrollmentIntakeError("The enrollment could not be created.");

  const paymentIds: string[] = [];
  for (let i = 0; i < input.payments.length; i++) {
    const p = input.payments[i];
    try {
      const result = await capturePayment(actor, leadId, {
        proof: p.proof,
        receivedAmount: p.receivedAmount,
        paymentDate: p.paymentDate,
        paymentMethod: p.paymentMethod,
        transactionId: p.transactionId,
        confirmations: p.confirmations,
        varianceReason: p.varianceReason,
        manualEntryNoOcr: p.manualEntryNoOcr,
      });
      paymentIds.push(result.paymentId);
      if (result.probableDuplicate) {
        warnings.push(`Payment ${i + 1} looks like a possible duplicate — please double-check it.`);
      }
    } catch (err) {
      // Do not roll back earlier valid work; surface which proof failed so it can be redone
      // on the lead page (its Payment Panel). The message is already safe (PaymentError).
      const reason = err instanceof PaymentError ? err.message : "It could not be recorded.";
      warnings.push(`Payment ${i + 1} (Txn ${p.transactionId}) was not recorded: ${reason}`);
    }
  }
  return { enrollmentId, paymentIds };
}

export async function commitEnrollmentBundle(actor: Actor, input: ReviewedBundle): Promise<CommitResult> {
  requirePermission(actor, "lead:create");
  requirePermission(actor, "payment:create");

  const warnings: string[] = [];
  // Lead (name + contact) — the dup mobile/email guard here is the re-submit backstop.
  const { id: leadId } = await createLead(actor, {
    fullName: input.learner.fullName,
    mobile: input.learner.mobile,
    email: input.learner.email,
    leadSource: input.learner.leadSource,
  });
  const { enrollmentId, paymentIds } = await fillLeadFromBundle(actor, leadId, input, warnings);
  return { leadId, enrollmentId, paymentIds, warnings };
}

/**
 * Fill an EXISTING lead from a reviewed bundle — the lead page's "Auto-fill from uploads".
 * Same fill steps as commit, minus createLead; ownership is enforced by getLeadForActor and
 * again inside each reused service. Safe to run on a fresh lead or to top up a partial one.
 */
export async function applyEnrollmentBundle(actor: Actor, leadId: string, input: ReviewedBundle): Promise<CommitResult> {
  requirePermission(actor, "lead:update:own");
  requirePermission(actor, "payment:create");
  await getLeadForActor(actor, leadId); // ownership — throws if not permitted / not found

  const warnings: string[] = [];
  const { enrollmentId, paymentIds } = await fillLeadFromBundle(actor, leadId, input, warnings);
  return { leadId, enrollmentId, paymentIds, warnings };
}

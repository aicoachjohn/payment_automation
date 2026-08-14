/**
 * Zod schemas shared between client and server (the validation boundary). Server
 * validation is the control; client validation is convenience only. FR-SEC-27+.
 */
import { z } from "zod";
import { Role, Program, Plan, ComboMode, ConcessionThresholdType, PaymentMethod, AuditStatus, PaymentType } from "@prisma/client";
import { PASSWORD_POLICY } from "@/lib/constants";

const strongPassword = z
  .string()
  .min(PASSWORD_POLICY.minLength, PASSWORD_POLICY.message)
  .regex(/[A-Z]/, PASSWORD_POLICY.message)
  .regex(/[0-9]/, PASSWORD_POLICY.message)
  .regex(/[^A-Za-z0-9]/, PASSWORD_POLICY.message);

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const otpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: strongPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: strongPassword,
});

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^(\+?\d{1,3}[- ]?)?\d{10}$/, "Enter a valid 10-digit mobile number.");

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the user's name."),
  email: emailSchema,
  mobile: mobileSchema,
  role: z.nativeEnum(Role),
  isBreakGlass: z.boolean().optional().default(false),
});

export const updateUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(Role),
});

export const userIdSchema = z.object({ userId: z.string().min(1) });

// ── Phase 3: pricing & fee engine ─────────────────────────────────────────────

const money2 = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount (up to 2 decimals).");

/**
 * Fee calculation input — selections ONLY. `.strict()` means any extra key (e.g. a
 * hand-typed `fee`/`standardFee`) is REJECTED: the client never supplies a fee, it
 * supplies selections and receives the computed fee (FR-SAL-20, BR-01).
 */
export const feeCalcSchema = z
  .object({
    program: z.nativeEnum(Program),
    plan: z.nativeEnum(Plan),
    comboMode: z.nativeEnum(ComboMode).nullish(),
  })
  .strict();

export const pricingInputSchema = z.object({
  program: z.nativeEnum(Program),
  plan: z.nativeEnum(Plan).nullish(),
  advancedFee: money2.nullish(),
  premiumFee: money2.nullish(),
  singleShotFee: money2.nullish(),
  doubleShotFee: money2.nullish(),
  comboFee: money2.nullish(),
  discount: money2.nullish(),
  gstPercent: z.string().trim().regex(/^\d{1,2}(\.\d{1,2})?$/).optional(),
  effectiveFrom: z.string().datetime().optional(),
  specialPricingName: z.string().trim().max(120).nullish(),
});

export const pricingUpdateSchema = pricingInputSchema.extend({ pricingId: z.string().min(1) });
export const pricingIdSchema = z.object({ pricingId: z.string().min(1) });

export const concessionThresholdSchema = z.object({
  plan: z.nativeEnum(Plan),
  // Exact-decimal strings — money and rate are never coerced through a JS float (FR-REC-07).
  amount: money2,
  percent: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage (0–100)."),
});

export const reasonCodesSchema = z.object({
  codes: z.array(z.string().trim().min(1)).max(50),
});

/** Concession input (used in Phase 4) — reason is MANDATORY (FR-SAL-26, BR-04). */
export const concessionSchema = z.object({
  concessionType: z.nativeEnum(ConcessionThresholdType),
  concessionValue: money2,
  reason: z.string().trim().min(3, "A reason is required for any concession."),
});

// ── Phase 4: leads, basic details, course & plan ──────────────────────────────

/**
 * The single validation message shown on ANY basic-details validation failure
 * (FR-SAL-09) — verbatim from the FRD. Every field below carries it.
 */
export const BASIC_DETAILS_ERROR =
  "The details must be the same in all places. Please enter the information correctly.";

const err = { message: BASIC_DETAILS_ERROR };

// Optional fields: accept "" (not yet filled) OR a correctly-formatted value. Only Full name,
// Email and Mobile are mandatory at capture (business decision); the rest can be filled later.
// The Operations handover stays strict — it re-checks the FULL record (isBasicComplete).
const optionalText = z.string().trim().max(200).optional();
const optionalDob = z
  .string()
  .trim()
  .refine((s) => s === "" || (!Number.isNaN(new Date(s).getTime()) && new Date(s).getTime() < Date.now()), err)
  .optional();
const optionalPincode = z
  .string()
  .trim()
  .refine((s) => s === "" || /^\d{6}$/.test(s), err)
  .optional();

export const basicDetailsSchema = z.object({
  fullName: z.string(err).trim().min(2, err), // required *
  email: z.string(err).trim().toLowerCase().email(err), // required *
  mobile: z
    .string(err)
    .trim()
    .regex(/^(\+?\d{1,3}[- ]?)?\d{10}$/, err), // required *
  dob: optionalDob,
  doorNo: optionalText,
  street: optionalText,
  address: optionalText,
  district: optionalText,
  state: optionalText,
  pincode: optionalPincode,
  leadSource: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

/**
 * STRICT variant for the PUBLIC self-intake form the lead fills — every field is mandatory
 * (mirrors isBasicComplete's full-record rule), plus the lead's program interest and a hidden
 * honeypot (`company` must stay empty; a value ⇒ bot). Salesperson confirms the final course.
 */
export const strictBasicDetailsSchema = z.object({
  fullName: z.string(err).trim().min(2, err),
  dob: z
    .string()
    .trim()
    .refine((s) => !Number.isNaN(new Date(s).getTime()) && new Date(s).getTime() < Date.now(), err),
  doorNo: z.string(err).trim().min(1, err),
  street: z.string(err).trim().min(1, err),
  address: z.string(err).trim().min(1, err),
  district: z.string(err).trim().min(1, err),
  state: z.string(err).trim().min(1, err),
  pincode: z.string(err).trim().regex(/^\d{6}$/, err),
  email: z.string(err).trim().toLowerCase().email(err),
  mobile: z
    .string(err)
    .trim()
    .regex(/^(\+?\d{1,3}[- ]?)?\d{10}$/, err),
  interestedProgram: z.nativeEnum(Program, err),
  interestedPlan: z.nativeEnum(Plan, err),
  company: z.string().max(0).optional(), // honeypot — must stay empty
});

/** The public intake submission = the strict details + the invite token. */
export const submitIntakeSchema = strictBasicDetailsSchema.extend({
  token: z.string().min(10),
});

/** A salesperson minting a self-intake link — an optional label to track who it's for. */
export const intakeInviteSchema = z.object({
  note: z.string().trim().max(120).optional(),
});

/** Removing (voiding) a lead — a mandatory reason is kept in history (BR-21/BR-26). */
export const voidLeadSchema = z.object({
  leadId: z.string().min(1),
  reason: z.string().trim().min(3, "Please give a short reason.").max(300),
});

/** New-lead create: only name + salesperson are required up front (FR-SAL-07). */
export const leadAutofillTextSchema = z.object({
  text: z.string().trim().min(2, "Paste the enquiry text to auto-fill.").max(5000),
});

export const leadCreateSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the learner's name."),
  mobile: z.string().trim().regex(/^(\+?\d{1,3}[- ]?)?\d{10}$/, "Enter a valid 10-digit mobile number.").optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").optional(),
  leadSource: z.string().trim().max(120).optional(),
});

export const duplicateCheckSchema = z.object({
  field: z.enum(["mobile", "email"]),
  value: z.string().trim().min(1),
});

export const leadIdSchema = z.object({ leadId: z.string().min(1) });

const courseSelectionObject = z.object({
  program: z.nativeEnum(Program),
  plan: z.nativeEnum(Plan),
  comboMode: z.nativeEnum(ComboMode).nullish(),
  commencingDate: z.string().datetime().nullish(),
  batch: z.string().trim().max(120).nullish(),
  courseStarted: z.boolean().optional(),
});

const comboRule = (v: { program: Program; comboMode?: ComboMode | null }) =>
  v.program !== Program.COMBO_ALL_THREE || !!v.comboMode;
const comboRuleOpts = {
  message: "Choose Single Shot or Double Shot for the Combo Pack.",
  path: ["comboMode"],
};

export const courseSelectionSchema = courseSelectionObject.refine(comboRule, comboRuleOpts);
export const courseSelectionWithLeadSchema = leadIdSchema
  .merge(courseSelectionObject)
  .refine(comboRule, comboRuleOpts);

export const concessionRequestSchema = leadIdSchema.merge(concessionSchema);

export const concessionDecisionSchema = z.object({
  leadId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(3, "A reason is required."),
});

// ── Phase 5: payment draft & template ─────────────────────────────────────────

export const draftTemplateSchema = z.object({
  template: z.string().min(10).max(20_000).optional(),
  bankDetails: z.string().max(4_000).optional(),
  instruction: z.string().max(2_000).optional(),
  whatsappEnabled: z.boolean().optional(),
});

// ── Phase 6: payment capture & proof ──────────────────────────────────────────

export const proofIdSchema = z.object({ proofId: z.string().min(1) });

/** One captured payment (proof + confirmed fields), shared by single-capture and intake. */
export const captureItemSchema = z.object({
  proof: z.object({
    key: z.string().min(1),
    checksum: z.string().min(1),
    fileType: z.string().min(1),
    fileSize: z.number().int().nonnegative(),
    originalFilename: z.string().min(1),
  }),
  receivedAmount: money2,
  paymentDate: z.string().datetime(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  transactionId: z.string().trim().min(4, "Enter the Transaction ID."),
  confirmations: z.object({
    receivedAmount: z.boolean(),
    paymentDate: z.boolean(),
    transactionId: z.boolean(),
    paymentMethod: z.boolean(),
  }),
  varianceReason: z.string().trim().max(1000).optional(),
  manualEntryNoOcr: z.boolean().default(false),
});

export const capturePaymentSchema = leadIdSchema.merge(captureItemSchema);

/** The salesperson confirming a lead-uploaded (held) proof into a payment — proof by id. */
export const confirmSelfProofSchema = z.object({
  leadId: z.string().min(1),
  selfProofId: z.string().min(1),
  receivedAmount: money2,
  paymentDate: z.string().datetime(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  transactionId: z.string().trim().min(4, "Enter the Transaction ID."),
  confirmations: z.object({
    receivedAmount: z.boolean(),
    paymentDate: z.boolean(),
    transactionId: z.boolean(),
    paymentMethod: z.boolean(),
  }),
  varianceReason: z.string().trim().max(1000).optional(),
});

// ── Enrollment intake (one-bundle hands-free capture) ─────────────────────────

/** Paste-the-message extract call (proofs travel as multipart, not in this schema). */
export const enrollmentExtractTextSchema = z.object({
  text: z.string().trim().min(2, "Paste the enrollment message to auto-fill.").max(8000),
});

/** The reviewed + confirmed bundle the intake screen posts. Fee is NEVER in here (rule #3). */
export const reviewedBundleObject = z.object({
  learner: basicDetailsSchema,
  course: courseSelectionObject.refine(comboRule, comboRuleOpts),
  payments: z.array(captureItemSchema).min(1, "At least one payment proof is required."),
});
export const reviewedBundleSchema = reviewedBundleObject;
/** Same bundle, but applied to an EXISTING lead (the lead page's "Auto-fill from uploads"). */
export const applyBundleSchema = leadIdSchema.merge(reviewedBundleObject);

// ── Phase 7: L1 audit decisions ───────────────────────────────────────────────

export const paymentIdSchema = z.object({ paymentId: z.string().min(1) });

export const approvePaymentSchema = z.object({
  paymentId: z.string().min(1),
  confirmations: z.object({
    amountMatches: z.boolean(),
    dateMatches: z.boolean(),
    transactionIdMatches: z.boolean(),
  }),
  varianceReason: z.string().trim().max(1000).optional(),
});

export const auditDecisionSchema = z.object({
  paymentId: z.string().min(1),
  reasonCode: z.string().trim().max(120).optional(),
  comment: z.string().trim().min(3, "A reason is required for this decision."),
});

export const bulkApproveSchema = z.object({
  paymentIds: z.array(z.string().min(1)).min(1).max(200),
});

export const correctResubmitSchema = z.object({
  paymentId: z.string().min(1),
  receivedAmount: money2.optional(),
  paymentDate: z.string().datetime().optional(),
  transactionId: z.string().trim().min(4).optional(),
});

export const auditFilterSchema = z.object({
  status: z.nativeEnum(AuditStatus).optional(),
  paymentType: z.nativeEnum(PaymentType).optional(),
  salespersonId: z.string().optional(),
  search: z.string().optional(),
});

// ── Finance dashboard (Phase 8) ───────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use a YYYY-MM-DD date.");

export const statementFilterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  paymentType: z.nativeEnum(PaymentType).optional(),
  typeGroup: z.enum(["holding", "followup"]).optional(),
  program: z.nativeEnum(Program).optional(),
  plan: z.nativeEnum(Plan).optional(),
  salespersonId: z.string().optional(),
  search: z.string().optional(),
});

export const customerFilterSchema = z.object({
  search: z.string().optional(),
  program: z.nativeEnum(Program).optional(),
  plan: z.nativeEnum(Plan).optional(),
  salespersonId: z.string().optional(),
  paymentStatus: z.enum(["FULLY_PAID", "PARTIAL", "UNPAID"]).optional(),
  enrollmentStatus: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const monthSelectSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const financeExportSchema = z.object({
  report: z.enum(["statement", "customers", "outstanding", "monthly", "gst"]),
  format: z.enum(["csv", "pdf"]),
});

export const financeQueryCreateSchema = z.object({
  paymentId: z.string().min(1),
  subject: z.string().trim().min(3, "Add a short subject.").max(140),
  message: z.string().trim().min(3, "Write your question.").max(2000),
});

export const financeQueryCommentSchema = z.object({
  queryId: z.string().min(1),
  message: z.string().trim().min(1, "Write a reply.").max(2000),
});

export const financeQueryIdSchema = z.object({ queryId: z.string().min(1) });

export const financeDigestSchema = z.object({
  daily: z.boolean(),
  monthly: z.boolean(),
});

export const enrollmentIdSchema = z.object({ enrollmentId: z.string().min(1) });

// ── Super Admin overrides + console (Phase 9) ─────────────────────────────────

const reason = z.string().trim().min(3, "A written reason is required.").max(2000);
const confirmations = z.object({
  amountMatches: z.boolean(),
  dateMatches: z.boolean(),
  transactionIdMatches: z.boolean(),
});

export const overrideInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("REVERSE_AUDIT"), paymentId: z.string().min(1), reason }),
  z.object({ kind: z.literal("UNLOCK_FEE"), enrollmentId: z.string().min(1), reason }),
  z.object({ kind: z.literal("REASSIGN_LEAD"), leadId: z.string().min(1), newSalespersonId: z.string().min(1), reason }),
  z.object({ kind: z.literal("APPROVE_CONCESSION"), leadId: z.string().min(1), reason }),
  z.object({ kind: z.literal("EXTEND_DEADLINE"), enrollmentId: z.string().min(1), days: z.coerce.number().int().positive().max(365), reason }),
  z.object({ kind: z.literal("REVERSE_OPS_TRANSFER"), enrollmentId: z.string().min(1), reason }),
  z.object({
    kind: z.literal("DELEGATED_AUDIT"),
    paymentId: z.string().min(1),
    decision: z.enum(["APPROVE", "CORRECTION", "REJECT"]),
    reason,
    confirmations: confirmations.optional(),
    varianceReason: z.string().trim().optional(),
  }),
  z.object({ kind: z.literal("VOID_PAYMENT"), paymentId: z.string().min(1), reason }),
]);

export const auditLogFilterSchema = z.object({
  performedBy: z.string().optional(),
  entityType: z.string().optional(),
  action: z.string().optional(),
  entityId: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const configSetSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string(), // raw JSON string; parsed server-side
  description: z.string().trim().max(300).optional(),
});

export const recordSearchSchema = z.object({ query: z.string().trim().max(120) });

// ── Automation, notifications, follow-ups, handover (Phase 10) ─────────────────

export const followUpCreateSchema = z.object({
  leadId: z.string().min(1),
  dueDate: z.string().min(1),
  description: z.string().trim().min(1, "Describe the follow-up.").max(500),
});

export const taskIdSchema = z.object({ taskId: z.string().min(1) });
export const notificationIdSchema = z.object({ notificationId: z.string().min(1) });
export const notificationPrefSchema = z.object({ type: z.string().min(1), emailEnabled: z.boolean() });
export const handoverEnrollmentSchema = z.object({ enrollmentId: z.string().min(1) });

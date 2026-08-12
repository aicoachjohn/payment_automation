/**
 * Zod schemas shared between client and server (the validation boundary). Server
 * validation is the control; client validation is convenience only. FR-SEC-27+.
 */
import { z } from "zod";
import { Role, Program, Plan, ComboMode, ConcessionThresholdType, PaymentMethod } from "@prisma/client";
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
  amount: z.number().nonnegative(),
  percent: z.number().min(0).max(100),
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

/** A valid past date (DOB). */
const pastDate = z
  .string()
  .refine((s) => {
    const d = new Date(s);
    return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
  }, err);

export const basicDetailsSchema = z.object({
  fullName: z.string(err).trim().min(2, err),
  dob: pastDate,
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
  leadSource: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

/** New-lead create: only name + salesperson are required up front (FR-SAL-07). */
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

export const capturePaymentSchema = z.object({
  leadId: z.string().min(1),
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

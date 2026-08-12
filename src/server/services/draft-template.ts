/**
 * Payment-draft template rendering (FR-SAL-32/33). Pure — no DB, no server-only — so it
 * is unit-testable and reusable by the Super Admin live preview. The template body and
 * bank details are CONFIGURATION (SystemConfig); this module only renders.
 *
 * Placeholder syntax: {{dotted.key}}. Values are pre-formatted strings (money via
 * formatINR, dates DD-MMM-YYYY). Substitution is safe: `{{`/`}}` are stripped from
 * values so a value can never inject another placeholder, and unknown keys render empty.
 */
import { Program, Plan, ComboMode, ConcessionStatus } from "@prisma/client";
import { formatINR, formatDate } from "@/lib/format";
import { renderTemplate } from "@/lib/template";

export { renderTemplate };

export const PROGRAM_LABEL: Record<Program, string> = {
  DATA_ANALYST: "Data Analyst",
  ADV_DATA_SCIENCE_AI: "Advanced Data Science & AI",
  AGENTIC_AI_GENAI: "Agentic AI + GenAI",
  COMBO_ALL_THREE: "Combo Pack – All Three",
};
const PLAN_LABEL: Record<Plan, string> = {
  ADVANCED: "Advanced (Group Mentoring)",
  PREMIUM: "Premium (One-on-One Mentorship)",
};
const COMBO_LABEL: Record<ComboMode, string> = {
  SINGLE_SHOT: "Single Shot",
  DOUBLE_SHOT: "Double Shot",
};

/** The mandatory basic-detail fields, with their human labels (FR-SAL-08/13). */
export interface BasicLead {
  fullName: string | null; dob: Date | null; doorNo: string | null; street: string | null;
  address: string | null; district: string | null; state: string | null; pincode: string | null;
  email: string | null; mobile: string | null;
}

/** Return the human labels of every mandatory basic-detail field that is missing/invalid. */
export function missingBasicFields(lead: BasicLead): string[] {
  const missing: string[] = [];
  const req: [keyof BasicLead, string, (v: string) => boolean][] = [
    ["fullName", "Full Name", (v) => v.trim().length >= 2],
    ["doorNo", "Door No.", (v) => v.trim().length >= 1],
    ["street", "Street", (v) => v.trim().length >= 1],
    ["address", "Address", (v) => v.trim().length >= 1],
    ["district", "District", (v) => v.trim().length >= 1],
    ["state", "State", (v) => v.trim().length >= 1],
    ["pincode", "Pincode", (v) => /^\d{6}$/.test(v.trim())],
    ["email", "Email", (v) => /.+@.+\..+/.test(v.trim())],
    ["mobile", "Mobile", (v) => /^(\+?\d{1,3}[- ]?)?\d{10}$/.test(v.trim())],
  ];
  for (const [key, label, ok] of req) {
    const value = lead[key];
    if (typeof value !== "string" || !ok(value)) missing.push(label);
  }
  if (!lead.dob || lead.dob.getTime() >= Date.now()) missing.push("Date of Birth");
  return missing;
}

export interface DraftContextInput {
  lead: BasicLead;
  enrollment: {
    program: Program; plan: Plan; comboMode: ComboMode | null;
    commencingDate: Date | null; standardFee: string; concessionAmount: string;
    concessionStatus: ConcessionStatus; finalApprovedFee: string;
  };
  schedule: { number: number; amount: string; dueDate: string }[];
  bankDetails: string;
  instruction: string;
}

function formatScheduleLines(schedule: { number: number; amount: string; dueDate: string }[]): string {
  if (schedule.length === 0) return "  (to be confirmed)";
  return schedule
    .map((s) => `  Instalment ${s.number}: ${formatINR(s.amount)} — due ${formatDate(s.dueDate)}`)
    .join("\n");
}

/** Whether the enrollment carries an applied concession (→ "Special" confirmation). */
export function isSpecial(concessionAmount: string, status: ConcessionStatus): boolean {
  return (
    Number(concessionAmount) > 0 &&
    (status === ConcessionStatus.AUTO_APPROVED || status === ConcessionStatus.APPROVED)
  );
}

/** Build the flat placeholder map for a draft. */
export function buildDraftContext(input: DraftContextInput): Record<string, string> {
  const { lead, enrollment: e } = input;
  const special = isSpecial(e.concessionAmount, e.concessionStatus);
  return {
    confirmation_type: special ? "Special" : "Regular",
    "learner.full_name": lead.fullName ?? "",
    "learner.dob": lead.dob ? formatDate(lead.dob) : "",
    "learner.address_full": `${lead.doorNo ?? ""} ${lead.street ?? ""}, ${lead.address ?? ""}, ${lead.district ?? ""}, ${lead.state ?? ""} - ${lead.pincode ?? ""}`.replace(/\s+/g, " ").trim(),
    "learner.email": lead.email ?? "",
    "learner.mobile": lead.mobile ?? "",
    "enrollment.program": PROGRAM_LABEL[e.program],
    "enrollment.plan": PLAN_LABEL[e.plan],
    "enrollment.combo_suffix": e.comboMode ? ` — ${COMBO_LABEL[e.comboMode]}` : "",
    "enrollment.commencing_date": e.commencingDate ? formatDate(e.commencingDate) : "To be confirmed",
    "enrollment.standard_fee": formatINR(e.standardFee),
    "enrollment.concession_line": special ? `• Concession: − ${formatINR(e.concessionAmount)}\n` : "",
    "enrollment.final_approved_fee": formatINR(e.finalApprovedFee),
    schedule: formatScheduleLines(input.schedule),
    bank_details: input.bankDetails,
    instruction: input.instruction,
  };
}

/** The default payment-draft template (seeded into SystemConfig; editable by SA). */
export const DEFAULT_DRAFT_TEMPLATE = `ProITbridge — Enrollment Confirmation ({{confirmation_type}})

Dear {{learner.full_name}},

Thank you for enrolling with ProITbridge. Please find your enrollment details below.

Learner details
• Name: {{learner.full_name}}
• Date of Birth: {{learner.dob}}
• Address: {{learner.address_full}}
• Email: {{learner.email}}
• Mobile: {{learner.mobile}}

Program
• Program: {{enrollment.program}}
• Plan: {{enrollment.plan}}{{enrollment.combo_suffix}}
• Commencing Date: {{enrollment.commencing_date}}

Fee
• Standard Fee: {{enrollment.standard_fee}}
{{enrollment.concession_line}}• Final Approved Fee: {{enrollment.final_approved_fee}}

Payment Schedule
{{schedule}}

Payment Details
{{bank_details}}

{{instruction}}`;

export const DEFAULT_BANK_DETAILS = `Account Name: ProITbridge
Account No.: 000000000000
IFSC: XXXX0000000
Bank: (configure in Super Admin → Templates)
UPI: proitbridge@upi`;

export const DEFAULT_DRAFT_INSTRUCTION =
  "After each payment, please share the payment screenshot along with the Transaction ID (UTR) so we can verify and confirm it.";

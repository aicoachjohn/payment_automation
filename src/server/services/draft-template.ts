/**
 * Payment-draft template rendering (FR-SAL-32/33). Pure — no DB, no server-only — so it
 * is unit-testable and reusable by the Super Admin live preview. The template body and
 * bank details are CONFIGURATION (SystemConfig); this module only renders.
 *
 * The default matches ProITbridge's real customer-facing WhatsApp message ("house
 * style"): INR.84,999/- money, "11th August 2026 (Tuesday)" dates, *bold* markers, the
 * plan in the header, and the full Kotak bank block. This is a deliberate exception to
 * the app's standard display convention (NFR-14) — the draft is a customer message, not
 * an app screen. Everything is Super-Admin-editable.
 */
import { Program, Plan, ComboMode, ConcessionStatus } from "@prisma/client";
import { formatDraftAmount, formatDate, formatDateLong } from "@/lib/format";
import { renderTemplate } from "@/lib/template";

export { renderTemplate };

export const PROGRAM_LABEL: Record<Program, string> = {
  DATA_ANALYST: "Advanced Data Analytics",
  ADV_DATA_SCIENCE_AI: "Advanced Data Science and AI",
  AGENTIC_AI_GENAI: "Gen AI & Agentic AI",
  COMBO_ALL_THREE: "Advanced Data Analytics + Advanced Data Science and AI + Gen AI & Agentic AI Program",
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
    .map((s) => `  Instalment ${s.number}: ${formatDraftAmount(s.amount)} — due ${formatDate(s.dueDate)}`)
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
    "learner.address_full": `${lead.doorNo ?? ""} ${lead.street ?? ""}, ${lead.address ?? ""}, ${lead.district ?? ""}, ${lead.state ?? ""}`.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim(),
    "learner.pincode": lead.pincode ?? "",
    "learner.email": lead.email ?? "",
    "learner.mobile": lead.mobile ?? "",
    "enrollment.program": PROGRAM_LABEL[e.program],
    "enrollment.plan": e.plan,
    "enrollment.plan_upper": e.plan,
    "enrollment.combo_suffix": e.comboMode ? ` — ${COMBO_LABEL[e.comboMode]}` : "",
    "enrollment.commencing_date": e.commencingDate ? formatDateLong(e.commencingDate) : "To be confirmed",
    "enrollment.standard_fee": formatDraftAmount(e.standardFee),
    "enrollment.concession_line": special
      ? `Concession : *${formatDraftAmount(e.concessionAmount)}* (Standard Fee ${formatDraftAmount(e.standardFee)})\n`
      : "",
    "enrollment.final_approved_fee": formatDraftAmount(e.finalApprovedFee),
    schedule: formatScheduleLines(input.schedule),
    bank_details: input.bankDetails,
    instruction: input.instruction,
  };
}

/** The default payment-draft template (seeded into SystemConfig; editable by SA). */
export const DEFAULT_DRAFT_TEMPLATE = `*Enrollment Confirmation - {{enrollment.plan_upper}}*

Full Name : {{learner.full_name}}
DOB : {{learner.dob}}
Full Address : {{learner.address_full}}
Pincode : {{learner.pincode}}
Email ID : {{learner.email}}
Mobile No : {{learner.mobile}}

Program Name : *{{enrollment.program}}{{enrollment.combo_suffix}} "{{enrollment.plan_upper}}"*

Course Fee : *{{enrollment.final_approved_fee}}*
{{enrollment.concession_line}}Commencing Date : *{{enrollment.commencing_date}}*

*Payment Schedule:*
{{schedule}}

*Payment Details:*

{{bank_details}}

Note: *{{instruction}}*

Thank you`;

export const DEFAULT_BANK_DETAILS = `Account Name: PROITBRIDGE OPC PVT LTD
BANK NAME: KOTAK MAHINDRA BANK
A/C NO: 8055242956
IFSC CODE: KKBK0008112
BRANCH NAME: HSR Layout Main Branch
MICR Code: 560485063`;

export const DEFAULT_DRAFT_INSTRUCTION =
  "Please do share the screenshot after the payment with the Transaction ID.";

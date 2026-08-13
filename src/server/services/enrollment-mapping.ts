/**
 * Pure, config-driven mapping from the free-text "Enrollment Confirmation" message to the
 * Program / Plan / ComboMode enums, plus a best-effort split of the single free-form
 * address line into the structured basic-details fields. Everything here is ASSISTIVE — the
 * salesperson reviews and confirms on the intake screen before anything is created. The
 * program keyword map is config-driven (rule #10): a Super Admin can override it via the
 * SystemConfig key `enrollment_program_map` without a code change; the constant below is the
 * fallback default.
 */
import { Program, Plan } from "@prisma/client";

/** keyword (lower-case, matched as a whole-word substring) → Program enum. */
export type ProgramKeywordMap = Record<string, Program>;

/** Fallback default when SystemConfig `enrollment_program_map` is unset (rule #10). */
export const DEFAULT_PROGRAM_KEYWORDS: ProgramKeywordMap = {
  "data analyst": Program.DATA_ANALYST,
  "data analytics": Program.DATA_ANALYST,
  "data science": Program.ADV_DATA_SCIENCE_AI,
  "advanced data science": Program.ADV_DATA_SCIENCE_AI,
  agentic: Program.AGENTIC_AI_GENAI,
  "gen ai": Program.AGENTIC_AI_GENAI,
  genai: Program.AGENTIC_AI_GENAI,
};

/**
 * Classify a free-text program name into a Program enum. A name that hits TWO OR MORE
 * distinct programs (as the real combo message does: "Advanced Data Analytics + Advanced
 * Data Science and AI + Gen AI & Agentic AI") is a COMBO_ALL_THREE; a single hit maps to
 * that program; no hit → undefined (the review screen forces a manual pick).
 */
export function classifyProgram(
  programName: string | undefined,
  keywords: ProgramKeywordMap = DEFAULT_PROGRAM_KEYWORDS,
): Program | undefined {
  if (!programName) return undefined;
  const hay = programName.toLowerCase();
  if (/\bcombo\b|all three|all 3/.test(hay)) return Program.COMBO_ALL_THREE;
  const hits = new Set<Program>();
  for (const [word, program] of Object.entries(keywords)) {
    if (hay.includes(word)) hits.add(program);
  }
  if (hits.size >= 2) return Program.COMBO_ALL_THREE;
  if (hits.size === 1) return [...hits][0];
  return undefined;
}

/**
 * Best-effort split of one free-form address line into the structured basic-details fields.
 * Never loses data — the whole line is preserved in `address`. Missing parts (commonly the
 * state, which the message rarely carries) are left blank for the salesperson to complete on
 * the editable review screen.
 */
export function splitAddress(fullAddress: string | undefined): {
  doorNo: string;
  street: string;
  address: string;
  district: string;
  state: string;
} {
  const address = (fullAddress ?? "").trim();
  const out = { doorNo: "", street: "", address, district: "", state: "" };
  if (!address) return out;

  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  // District: a part ending in "Dt"/"Dist"/"District" (Indian address convention).
  const districtPart = parts.find((p) => /\b(d(?:istric)?t|dist)\.?$/i.test(p));
  if (districtPart) out.district = districtPart.replace(/\b(d(?:istric)?t|dist)\.?$/i, "").trim();

  // Door no + street from the first part: leading token if it looks like a door/plot number.
  const first = parts[0] ?? address;
  const m = /^([\d]+[\w/.-]*)\s+(.*)$/.exec(first);
  if (m) {
    out.doorNo = m[1];
    out.street = m[2].trim();
  } else {
    out.street = first;
  }
  return out;
}

/** Map the plan word to the Plan enum. */
export function classifyPlan(plan: Plan | undefined): Plan | undefined {
  return plan;
}

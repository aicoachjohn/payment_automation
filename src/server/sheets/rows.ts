/**
 * The shape of the Google Sheets mirror: one row per lead, one column per field.
 *
 * Pure — no DB, no network — so the column order and every formatting decision is unit
 * testable. That matters more than it sounds: the sheet is matched to existing rows by the
 * lead id in column A, so if the columns ever drift out of step with the header the mirror
 * silently writes values into the wrong columns.
 *
 * Money is rendered as a plain decimal string ("34999.00"), never a float and never with a
 * ₹ prefix, so Sheets stores an exact number that still sums correctly in a spreadsheet.
 */

export const SHEET_COLUMNS = [
  "Lead ID",
  "Created",
  "Salesperson",
  "Learner Name",
  "Mobile",
  "Email",
  "Date of Birth",
  "Address",
  "District",
  "State",
  "Pincode",
  "Program",
  "Plan",
  "Combo Mode",
  "Commencing Date",
  "Final Fee",
  "Total Approved",
  "Balance",
  "Payments",
  "Lead Status",
  "Approval Status",
  "Last Synced",
] as const;

export interface SheetLead {
  id: string;
  createdAt: Date;
  salespersonName: string;
  fullName: string;
  mobile: string | null;
  email: string | null;
  dob: Date | null;
  addressParts: (string | null)[];
  district: string | null;
  state: string | null;
  pincode: string | null;
  program: string | null;
  plan: string | null;
  comboMode: string | null;
  commencingDate: Date | null;
  /** Exact decimal strings — never numbers (BR-29). */
  finalApprovedFee: string | null;
  totalApproved: string;
  balance: string;
  paymentCount: number;
  approvedCount: number;
  leadStatus: string;
  approvalLabel: string;
}

/** `YYYY-MM-DD`, which Sheets reads as a date rather than as text. */
function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/**
 * One row, in SHEET_COLUMNS order. Every cell is a string: the Sheets API is given
 * USER_ENTERED so a numeric string becomes a number and a YYYY-MM-DD string becomes a date,
 * while text stays text.
 */
export function buildLeadRow(lead: SheetLead, syncedAt: Date): string[] {
  const row = [
    lead.id,
    isoDate(lead.createdAt),
    lead.salespersonName,
    lead.fullName,
    // Leading apostrophe keeps a +91… number as text; Sheets would otherwise read it as a
    // formula and show an error in the cell.
    lead.mobile ? `'${lead.mobile}` : "",
    lead.email ?? "",
    isoDate(lead.dob),
    lead.addressParts.filter(Boolean).join(", "),
    lead.district ?? "",
    lead.state ?? "",
    lead.pincode ?? "",
    lead.program ?? "",
    lead.plan ?? "",
    lead.comboMode ?? "",
    isoDate(lead.commencingDate),
    lead.finalApprovedFee ?? "",
    lead.totalApproved,
    lead.balance,
    `${lead.approvedCount} of ${lead.paymentCount} approved`,
    lead.leadStatus,
    lead.approvalLabel,
    syncedAt.toISOString(),
  ];

  // A drifted row would write values into the wrong columns silently, so fail loudly here
  // rather than corrupt the sheet.
  if (row.length !== SHEET_COLUMNS.length) {
    throw new Error(
      `Sheet row has ${row.length} cells but ${SHEET_COLUMNS.length} columns are defined.`,
    );
  }
  return row;
}

/** A1 range covering every column, e.g. "Leads!A1:V1". */
export function fullRowRange(sheetName: string, rowNumber: number): string {
  return `${sheetName}!A${rowNumber}:${columnLetter(SHEET_COLUMNS.length)}${rowNumber}`;
}

/** 1 → A, 26 → Z, 27 → AA. */
export function columnLetter(index1Based: number): string {
  let n = index1Based;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

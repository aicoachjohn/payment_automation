/**
 * The Google Sheets mirror's row shape.
 *
 * The sheet matches existing rows by the lead id in column A, so a row that drifts out of
 * step with the header writes values into the WRONG columns — silently, and into a document
 * people read as the book of business. These tests exist to make that impossible.
 */
import { describe, expect, it } from "vitest";
import { SHEET_COLUMNS, buildLeadRow, columnLetter, type SheetLead } from "@/server/sheets/rows";

const SYNCED = new Date("2026-08-20T10:00:00.000Z");

const lead = (over: Partial<SheetLead> = {}): SheetLead => ({
  id: "lead_1",
  createdAt: new Date("2026-08-13T00:00:00.000Z"),
  salespersonName: "Mathiew",
  fullName: "Kumar Krishnasamy",
  mobile: "+14805226088",
  email: "k@example.com",
  dob: new Date("1996-04-04T00:00:00.000Z"),
  addressParts: ["3", "Adyar", null],
  district: "Chennai",
  state: "Tamil Nadu",
  pincode: "600020",
  program: "COMBO_ALL_THREE",
  plan: "PREMIUM",
  comboMode: "DOUBLE_SHOT",
  commencingDate: new Date("2026-09-01T00:00:00.000Z"),
  finalApprovedFee: "84999.00",
  totalApproved: "50000.00",
  balance: "34999.00",
  paymentCount: 2,
  approvedCount: 1,
  leadStatus: "DOWN_PAYMENT_PENDING",
  approvalLabel: "Pending with Nandhiya",
  ...over,
});

describe("buildLeadRow", () => {
  it("produces exactly one cell per declared column", () => {
    expect(buildLeadRow(lead(), SYNCED)).toHaveLength(SHEET_COLUMNS.length);
  });

  it("puts the lead id in column A — the key the sheet is matched on", () => {
    expect(buildLeadRow(lead(), SYNCED)[0]).toBe("lead_1");
    expect(SHEET_COLUMNS[0]).toBe("Lead ID");
  });

  it("writes money as a plain decimal string, never a float or a ₹ figure", () => {
    const row = buildLeadRow(lead(), SYNCED);
    const fee = row[SHEET_COLUMNS.indexOf("Final Fee")];
    expect(fee).toBe("84999.00");
    expect(fee).not.toMatch(/[₹,]/); // a formatted string would land in Sheets as TEXT
    expect(row[SHEET_COLUMNS.indexOf("Balance")]).toBe("34999.00");
  });

  it("keeps a +country-code mobile as text so Sheets does not read it as a formula", () => {
    const row = buildLeadRow(lead(), SYNCED);
    expect(row[SHEET_COLUMNS.indexOf("Mobile")]).toBe("'+14805226088");
  });

  it("writes dates as YYYY-MM-DD so Sheets stores real dates", () => {
    const row = buildLeadRow(lead(), SYNCED);
    expect(row[SHEET_COLUMNS.indexOf("Created")]).toBe("2026-08-13");
    expect(row[SHEET_COLUMNS.indexOf("Commencing Date")]).toBe("2026-09-01");
  });

  it("renders an empty lead without holes — every cell is still a string", () => {
    const row = buildLeadRow(
      lead({
        mobile: null, email: null, dob: null, addressParts: [null, null, null],
        district: null, state: null, pincode: null, program: null, plan: null,
        comboMode: null, commencingDate: null, finalApprovedFee: null,
      }),
      SYNCED,
    );
    expect(row).toHaveLength(SHEET_COLUMNS.length);
    for (const cell of row) expect(typeof cell).toBe("string");
  });

  it("carries the approval status, so the sheet answers the same question as the dashboard", () => {
    const row = buildLeadRow(lead(), SYNCED);
    expect(row[SHEET_COLUMNS.indexOf("Approval Status")]).toBe("Pending with Nandhiya");
  });
});

describe("columnLetter", () => {
  it("maps 1-based indexes to spreadsheet letters", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(22)).toBe("V");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
  });

  it("covers the declared column count without wrapping wrongly", () => {
    expect(columnLetter(SHEET_COLUMNS.length)).toMatch(/^[A-Z]+$/);
  });
});

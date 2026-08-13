/**
 * Enrollment-intake parsers (FR-SAL-08 assist, hands-free capture). The sales team pastes
 * the WhatsApp "Enrollment Confirmation" and drops the payment proofs — nothing is typed.
 * These pure parsers turn that text into reviewable fields. Tested against the REAL sample
 * message + the two real proof formats (Paytm/UPI screenshot, bank NEFT receipt).
 */
import { describe, expect, it } from "vitest";
import { PaymentMethod, Plan } from "@prisma/client";
import { parseEnrollmentText, parseReceiptText } from "@/server/ocr";

// The exact real enrollment message the sales team forwards.
const ENROLLMENT = `Rajesh P
*Enrollment Confirmation - PREMIUM

Full Name : Suresh Kumar Krishnasamy
DOB : 08/01/1984
Full Address : 56A/6 S.Thiruvenkitapuram, Rajapalayam Tk, Virudhunagar Dt
Pincode : 626136
Email ID: sureshkkrishnasamy@gmail.com
Mobile No: +1 4805226086

Program Name: *Advanced Data Analytics + Advanced Data Science and AI + Gen AI & Agentic AI Program  "PREMIUM"

Course fee : *INR.84,999/-*

Commencing Date: *11th August 2026 (Tuesday)*`;

describe("parseEnrollmentText — real 'Enrollment Confirmation' message", () => {
  const f = parseEnrollmentText(ENROLLMENT);

  it("reads the learner's full name", () => {
    expect(f.fullName).toBe("Suresh Kumar Krishnasamy");
  });
  it("reads DOB day-first (DD/MM/YYYY → ISO)", () => {
    expect(f.dob?.slice(0, 10)).toBe("1984-01-08");
  });
  it("reads the full address and 6-digit pincode", () => {
    expect(f.fullAddress).toBe("56A/6 S.Thiruvenkitapuram, Rajapalayam Tk, Virudhunagar Dt");
    expect(f.pincode).toBe("626136");
  });
  it("reads and lowercases the email", () => {
    expect(f.email).toBe("sureshkkrishnasamy@gmail.com");
  });
  it("keeps an international mobile (+1 …)", () => {
    expect(f.mobile).toBe("+14805226086");
  });
  it("maps the plan tag to the Plan enum", () => {
    expect(f.plan).toBe(Plan.PREMIUM);
  });
  it("extracts the free-text program name without the trailing plan tag", () => {
    expect(f.programName).toBe(
      "Advanced Data Analytics + Advanced Data Science and AI + Gen AI & Agentic AI Program",
    );
  });
  it("extracts the course fee as digits (cross-check only)", () => {
    expect(f.courseFee).toBe("84999");
  });
  it("reads the commencing date", () => {
    expect(f.commencingDate?.slice(0, 10)).toBe("2026-08-11");
  });
});

describe("parseEnrollmentText — nothing usable", () => {
  it("returns empty for a message with no learner fields", () => {
    expect(parseEnrollmentText("hello, following up on the demo")).toEqual({});
  });
});

describe("parseReceiptText — fixes for the real proofs", () => {
  it("resolves a YEARLESS Paytm date using the fallback year", () => {
    const paytm = `₹34,999\nPaid Successfully\nMs S Nirmala\n11 Aug, 06:45 PM | Ref No: 3122 4582 5686`;
    const r = parseReceiptText(paytm, 2026);
    expect(r.fields.paymentDate?.slice(0, 10)).toBe("2026-08-11");
    expect(r.fields.receivedAmount).toBe("34999");
    expect(r.fields.transactionId).toBe("312245825686");
  });
  it("leaves a yearless date unset when no fallback year is given", () => {
    const r = parseReceiptText("₹34,999\n11 Aug, 06:45 PM");
    expect(r.fields.paymentDate).toBeUndefined();
  });
  it("keeps the payer name with its initial (from 'From <name>')", () => {
    const paytm = `Paytm\nProitbridge Opc Pvt Ltd\n₹34,999\nFrom\nMs S Nirmala\nIndian Bank - 7348`;
    expect(parseReceiptText(paytm).fields.payerName).toBe("Ms S Nirmala");
  });
  it("finds the NEFT payer and rejects header/payee noise", () => {
    const neft = `Transaction Details\nMEGALA SEGAR\nFrom Account : XXXXXXXXXXX4155\nAmount : Rs.50000\nPayee Name : PROITBRIDGE OPC PVT LTD\nPayment Mode : NEFT\nReference No: 2DHERX1J5191`;
    const r = parseReceiptText(neft);
    expect(r.fields.payerName).toBe("MEGALA SEGAR"); // not "Transaction Details" / "From Account" / the payee
    expect(r.fields.paymentMethod).toBe(PaymentMethod.NEFT);
  });

  it("recovers the amount from words when OCR drops the ₹ figure (REAL Paytm OCR output)", () => {
    // Verbatim Tesseract output for the real Paytm screenshot — the big "₹34,999" was NOT
    // read, but the amount-in-words line was.
    const realOcr = `Proitbridge Opc Pvt Ltd\n@ Kotak Mahindra Bank A/c - 2956\nThirty Four Thousand Nine Hundred Ninety Nine Rupees\nPaid Successfully &\n\nSuresh kumar Krishnasamy\n«« From »e-\nMs S Nirmala\n\n© Indian Bank - 7348\n\n11 Aug, 06:45 PM | Ref No: 3122 4582 5686`;
    const r = parseReceiptText(realOcr, 2026);
    expect(r.fields.receivedAmount).toBe("34999");
    expect(r.fields.transactionId).toBe("312245825686");
    expect(r.fields.paymentDate?.slice(0, 10)).toBe("2026-08-11");
    expect(r.fields.payerName).toBe("Ms S Nirmala");
  });

  it("reads a comma-grouped amount even without a currency symbol", () => {
    expect(parseReceiptText("Paid 1,24,999 to college").fields.receivedAmount).toBe("124999");
  });

  it("does not invent an amount from an account/reference number", () => {
    expect(parseReceiptText("A/c - 2956\nRef No: 3122 4582 5686").fields.receivedAmount).toBeUndefined();
  });
});

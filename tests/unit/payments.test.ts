import { describe, expect, it } from "vitest";
import { PaymentType, PaymentMethod } from "@prisma/client";
import { derivePaymentType, expectedAmountFor, clearsBalance } from "@/server/services/payment-rules";
import { detectFileType, validateProofFile } from "@/server/storage/validate";
import { parseReceiptText } from "@/server/ocr";

describe("payment-rules — system-derived type/number (FRD §3.3, BR-07)", () => {
  it("payment 1 is HOLDING when course not started, STARTING when started", () => {
    expect(derivePaymentType(1, false, false)).toBe(PaymentType.COURSE_HOLDING);
    expect(derivePaymentType(1, true, false)).toBe(PaymentType.COURSE_STARTING);
  });
  it("payment 2 is DOWN_PAYMENT, or FINAL_PAYMENT when it clears the balance (BR-07)", () => {
    expect(derivePaymentType(2, false, false)).toBe(PaymentType.DOWN_PAYMENT);
    expect(derivePaymentType(2, false, true)).toBe(PaymentType.FINAL_PAYMENT);
  });
  it("payment 3 is always FINAL_PAYMENT", () => {
    expect(derivePaymentType(3, false, false)).toBe(PaymentType.FINAL_PAYMENT);
  });
  it("expectedAmountFor reads the schedule, else the outstanding balance", () => {
    const schedule = [{ number: 1, amount: "40000" }, { number: 2, amount: "40000" }, { number: 3, amount: "9999" }];
    expect(expectedAmountFor(schedule, 2, "50000").toFixed(2)).toBe("40000.00");
    expect(expectedAmountFor(schedule, 9, "1234.5").toFixed(2)).toBe("1234.50");
  });
  it("clearsBalance is true only when received >= outstanding", () => {
    expect(clearsBalance("10000", "10000")).toBe(true);
    expect(clearsBalance("10000", "9999")).toBe(false);
    expect(clearsBalance("10000", "12000")).toBe(true);
  });
});

describe("file validation — magic bytes, not extension (FR-SEC-22, NFR-15)", () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // "MZ"
  const txt = new TextEncoder().encode("this is a text file, not an image");

  it("detects jpg/png/pdf by content", () => {
    expect(detectFileType(jpg)).toBe("image/jpeg");
    expect(detectFileType(png)).toBe("image/png");
    expect(detectFileType(pdf)).toBe("application/pdf");
  });
  it("rejects a renamed .exe and a text file", () => {
    expect(detectFileType(exe)).toBeNull();
    expect(validateProofFile(exe, 10_000).ok).toBe(false);
    expect(validateProofFile(txt, 10_000).ok).toBe(false);
  });
  it("rejects empty and oversized files", () => {
    expect(validateProofFile(new Uint8Array(0), 10_000).ok).toBe(false);
    expect(validateProofFile(new Uint8Array(20), 10).ok).toBe(false); // > 10 byte cap
  });
  it("accepts a valid jpg within the limit", () => {
    const r = validateProofFile(jpg, 10_000);
    expect(r.ok).toBe(true);
    expect(r.type).toBe("image/jpeg");
  });
});

describe("OCR mock — parses real ProITbridge proof formats (FR-SAL-39)", () => {
  it("parses a Paytm/UPI screenshot text", () => {
    const paytm = `Paytm\nProitbridge Opc Pvt Ltd\nKotak Mahindra Bank A/c - 2956\n₹34,999\nPaid Successfully\nSuresh kumar Krishnasamy\nFrom\nMs S Nirmala\nIndian Bank - 7348\n11 Aug 2026, 06:45 PM\nRef No: 3122 4582 5686`;
    const r = parseReceiptText(paytm);
    expect(r.fields.receivedAmount).toBe("34999");
    expect(r.fields.transactionId).toBe("312245825686");
    expect(r.fields.paymentMethod).toBe(PaymentMethod.UPI); // Paytm → UPI
    expect(r.fields.paymentDate?.slice(0, 10)).toBe("2026-08-11");
    expect(r.confidence.receivedAmount).toBeGreaterThan(0.5);
  });
  it("parses a bank NEFT receipt text", () => {
    const neft = `Transaction Details\nMEGALA SEGAR\nFrom Account : XXXXXXXXXXX4155\nAmount : Rs.50000\nPayee Account No: XXXXXX2956\nPayee Bank : KOTAK MAHINDRA BANK LIMITED\nPayee Name : PROITBRIDGE OPC PVT LTD\nPayment Mode : NEFT\nReference No: 2DHERX1J5191\nDate: 11 Aug 2026`;
    const r = parseReceiptText(neft);
    expect(r.fields.receivedAmount).toBe("50000");
    expect(r.fields.transactionId).toBe("2DHERX1J5191");
    expect(r.fields.paymentMethod).toBe(PaymentMethod.NEFT);
  });
  it("returns empty fields for unreadable content (→ manual entry, FR-SAL-47)", () => {
    const r = parseReceiptText("random noise with no receipt fields");
    expect(Object.keys(r.fields).length).toBe(0);
  });
});

/**
 * Lead auto-fill parser (FR-SAL-08 assist). Extracts name/mobile/email/source from a
 * pasted message or OCR'd document text so the salesperson never types the details.
 */
import { describe, expect, it } from "vitest";
import { parseLeadText } from "@/server/ocr";

describe("parseLeadText — labelled enquiry", () => {
  it("reads name, mobile, email and source from a labelled block", () => {
    const f = parseLeadText("Name: Priya Sharma\nMobile: 98765 43210\nEmail: Priya@Example.com\nSource: Instagram");
    expect(f.fullName).toBe("Priya Sharma");
    expect(f.mobile).toBe("9876543210");
    expect(f.email).toBe("priya@example.com");
    expect(f.leadSource).toBe("Instagram");
  });
});

describe("parseLeadText — free-form WhatsApp message", () => {
  it("finds the mobile with a +91 prefix and separators", () => {
    expect(parseLeadText("Hi, please add +91-98765-43210").mobile).toBe("9876543210");
    expect(parseLeadText("call me on 09123456789").mobile).toBe("9123456789");
  });
  it("picks a platform keyword as the source", () => {
    expect(parseLeadText("Got the lead via Referral yesterday, email a@b.com").leadSource).toBe("Referral");
  });
  it("ignores a source keyword when guessing the name", () => {
    const f = parseLeadText("Rahul Verma\nInstagram\nrahul@x.com");
    expect(f.fullName).toBe("Rahul Verma");
    expect(f.email).toBe("rahul@x.com");
  });
});

describe("parseLeadText — nothing usable", () => {
  it("returns empty when there is no contact info", () => {
    expect(parseLeadText("garbled 1234 ??? text")).toEqual({});
  });
  it("does not misread a random long number as a mobile", () => {
    expect(parseLeadText("order 1234567890123 shipped").mobile).toBeUndefined();
  });
});

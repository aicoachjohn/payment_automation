import { describe, expect, it } from "vitest";
import { Program, Plan, ComboMode, ConcessionStatus } from "@prisma/client";
import { renderTemplate } from "@/lib/template";
import {
  buildDraftContext,
  missingBasicFields,
  DEFAULT_DRAFT_TEMPLATE,
} from "@/server/services/draft-template";

describe("renderTemplate — safe substitution (FR-SAL-33)", () => {
  it("substitutes dotted keys, leaves unknown keys empty", () => {
    expect(renderTemplate("Hi {{a}} {{b.c}}!", { a: "x", "b.c": "y" })).toBe("Hi x y!");
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });
  it("strips braces from values so a value cannot inject a placeholder", () => {
    expect(renderTemplate("{{v}}", { v: "{{evil}}" })).toBe("evil");
  });
});

describe("missingBasicFields — names each missing mandatory field (FR-SAL-13)", () => {
  const complete = {
    fullName: "Aisha", dob: new Date("2000-01-01"), doorNo: "1", street: "s", address: "a",
    district: "d", state: "st", pincode: "560001", email: "a@b.com", mobile: "9876543210",
  };
  it("empty for a complete lead", () => {
    expect(missingBasicFields(complete)).toEqual([]);
  });
  it("names Pincode when it is invalid", () => {
    expect(missingBasicFields({ ...complete, pincode: "123" })).toContain("Pincode");
  });
  it("names Date of Birth when missing or future", () => {
    expect(missingBasicFields({ ...complete, dob: null })).toContain("Date of Birth");
    expect(missingBasicFields({ ...complete, dob: new Date("2999-01-01") })).toContain("Date of Birth");
  });
});

describe("buildDraftContext + default template — all 13 FR-SAL-32 elements present", () => {
  const ctx = buildDraftContext({
    lead: {
      fullName: "Priya Sharma", dob: new Date("1998-05-20"), doorNo: "12A", street: "MG Road",
      address: "Indiranagar", district: "Bengaluru", state: "Karnataka", pincode: "560038",
      email: "priya@example.com", mobile: "9876543210",
    },
    enrollment: {
      program: Program.COMBO_ALL_THREE, plan: Plan.PREMIUM, comboMode: ComboMode.DOUBLE_SHOT,
      commencingDate: new Date("2026-09-01"), standardFee: "89999.00", concessionAmount: "2000.00",
      concessionStatus: ConcessionStatus.APPROVED, finalApprovedFee: "87999.00",
    },
    schedule: [
      { number: 1, amount: "43999.50", dueDate: "2026-09-01T00:00:00.000Z" },
      { number: 2, amount: "43999.50", dueDate: "2026-09-16T00:00:00.000Z" },
    ],
    bankDetails: "Account Name: ProITbridge\nUPI: proitbridge@upi",
    instruction: "Share the payment screenshot with the Transaction ID.",
  });
  const out = renderTemplate(DEFAULT_DRAFT_TEMPLATE, ctx);

  const checks: [string, RegExp][] = [
    ["1. confirmation type", /Special/],
    ["2. full name", /Priya Sharma/],
    ["3. date of birth", /20-May-1998/],
    ["4. address incl. pincode", /560038/],
    ["5. email", /priya@example\.com/],
    ["6. mobile", /9876543210/],
    ["7. program", /Combo Pack/],
    ["8. plan (+ combo)", /Premium.*Double Shot/],
    ["9. final approved fee (+ concession)", /Final Approved Fee: ₹87,999\.00/],
    ["9b. concession shown", /Concession: − ₹2,000\.00/],
    ["10. commencing date", /01-Sep-2026/],
    ["11. payment schedule", /Instalment 1: ₹43,999\.50 — due 01-Sep-2026/],
    ["12. bank details", /Account Name: ProITbridge/],
    ["13. screenshot + Txn ID instruction", /Transaction ID/],
  ];
  for (const [label, re] of checks) {
    it(`contains ${label}`, () => {
      expect(out).toMatch(re);
    });
  }

  it("a concession-free lead renders a Regular confirmation with no concession line", () => {
    const regular = buildDraftContext({
      lead: { fullName: "X", dob: new Date("2000-01-01"), doorNo: "1", street: "s", address: "a", district: "d", state: "st", pincode: "560001", email: "x@y.com", mobile: "9876543210" },
      enrollment: { program: Program.DATA_ANALYST, plan: Plan.ADVANCED, comboMode: null, commencingDate: null, standardFee: "24999.00", concessionAmount: "0.00", concessionStatus: ConcessionStatus.NONE, finalApprovedFee: "24999.00" },
      schedule: [{ number: 1, amount: "24999.00", dueDate: "2026-09-01T00:00:00.000Z" }],
      bankDetails: "bank", instruction: "instr",
    });
    expect(regular.confirmation_type).toBe("Regular");
    expect(regular["enrollment.concession_line"]).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { Program, Plan } from "@prisma/client";
import { basicDetailsSchema, strictBasicDetailsSchema, BASIC_DETAILS_ERROR } from "@/lib/schemas";

const valid = {
  fullName: "Aisha Khan",
  dob: "2000-01-15",
  doorNo: "12A",
  street: "MG Road",
  address: "Indiranagar",
  district: "Bengaluru",
  state: "Karnataka",
  pincode: "560038",
  email: "aisha@example.com",
  mobile: "9876543210",
};

describe("basicDetailsSchema — FR-SAL-09 validation & the exact message", () => {
  it("accepts a fully valid basic-details payload", () => {
    expect(basicDetailsSchema.safeParse(valid).success).toBe(true);
  });

  const badCases: { field: string; payload: Record<string, string> }[] = [
    { field: "pincode (5 digits)", payload: { ...valid, pincode: "12345" } },
    { field: "pincode (non-numeric)", payload: { ...valid, pincode: "56A038" } },
    { field: "email", payload: { ...valid, email: "not-an-email" } },
    { field: "mobile (9 digits)", payload: { ...valid, mobile: "987654321" } },
    { field: "dob (future)", payload: { ...valid, dob: "2999-01-01" } },
    { field: "missing name", payload: { ...valid, fullName: "" } },
  ];

  for (const c of badCases) {
    it(`rejects invalid ${c.field} with the EXACT FRD message`, () => {
      const res = basicDetailsSchema.safeParse(c.payload);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toBe(BASIC_DETAILS_ERROR);
      }
    });
  }

  it("mobile accepts an optional country code", () => {
    expect(basicDetailsSchema.safeParse({ ...valid, mobile: "+91 9876543210" }).success).toBe(true);
  });

  const minimal = { fullName: "Aisha Khan", email: "aisha@example.com", mobile: "9876543210" };
  it("accepts just name + email + mobile (address/DOB omitted — only these 3 are mandatory)", () => {
    expect(basicDetailsSchema.safeParse(minimal).success).toBe(true);
  });
  it("accepts blank optional fields", () => {
    expect(basicDetailsSchema.safeParse({ ...minimal, dob: "", doorNo: "", street: "", address: "", district: "", state: "", pincode: "" }).success).toBe(true);
  });
  it("still rejects a missing mandatory field (email)", () => {
    expect(basicDetailsSchema.safeParse({ fullName: "Aisha", mobile: "9876543210" }).success).toBe(false);
  });
  it("still validates an optional field WHEN provided (bad pincode)", () => {
    expect(basicDetailsSchema.safeParse({ ...minimal, pincode: "12345" }).success).toBe(false);
  });
});

describe("strictBasicDetailsSchema — the PUBLIC self-intake form (all fields required)", () => {
  const full = {
    fullName: "Aisha Khan", dob: "2000-01-15", doorNo: "12A", street: "MG Road", address: "Indiranagar",
    district: "Bengaluru", state: "Karnataka", pincode: "560038", email: "aisha@example.com",
    mobile: "9876543210", interestedProgram: Program.COMBO_ALL_THREE, interestedPlan: Plan.PREMIUM,
  };
  it("accepts a complete payload with program interest", () => {
    expect(strictBasicDetailsSchema.safeParse(full).success).toBe(true);
  });
  it("rejects when ANY basic field is missing (unlike the relaxed capture schema)", () => {
    for (const k of ["dob", "doorNo", "street", "address", "district", "state", "pincode"] as const) {
      expect(strictBasicDetailsSchema.safeParse({ ...full, [k]: "" }).success).toBe(false);
    }
  });
  it("requires the program interest", () => {
    const { interestedProgram: _p, ...noProgram } = full;
    void _p;
    expect(strictBasicDetailsSchema.safeParse(noProgram).success).toBe(false);
  });
  it("rejects when the honeypot is filled (bot)", () => {
    expect(strictBasicDetailsSchema.safeParse({ ...full, company: "Acme Corp" }).success).toBe(false);
  });
});

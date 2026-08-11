import { describe, expect, it } from "vitest";
import { AuditStatus } from "@prisma/client";
import {
  money,
  add,
  sub,
  mul,
  sum,
  round,
  eq,
  applyGst,
  extractBase,
  decomposeInclusive,
  formatINR,
  calculateBalance,
  type BalancePayment,
  type MoneyInput,
} from "@/server/money";

// Format to a fixed 2dp string. Decimal tracks value, not scale, so `24999` and
// `24999.00` are equal — we compare the padded 2dp form the DB (NUMERIC(12,2)) stores.
const s = (v: MoneyInput) => money(v).toFixed(2);

describe("money — basic arithmetic (Decimal in, Decimal out)", () => {
  it("money() coerces to Decimal exactly from strings", () => {
    expect(s(money("1234.56"))).toBe("1234.56");
    expect(eq(money("1"), money("1.00"))).toBe(true);
  });

  it("add / sub / mul", () => {
    expect(s(round(add("100.10", "200.20")))).toBe("300.30");
    expect(s(round(sub("300.30", "100.10")))).toBe("200.20");
    expect(s(round(mul("19999", "2")))).toBe("39998.00");
  });

  it("sum of a list, empty → 0", () => {
    expect(s(round(sum(["10.00", "20.50", "0.50"])))).toBe("31.00");
    expect(s(sum([]))).toBe("0.00");
  });
});

describe("money — rounding is half-up to 2dp (FR-REC-08)", () => {
  it("rounds half away from zero", () => {
    expect(s(round("2.005"))).toBe("2.01");
    expect(s(round("2.004"))).toBe("2.00");
    expect(s(round("0.125"))).toBe("0.13");
    expect(s(round("-2.005"))).toBe("-2.01");
    expect(s(round("1"))).toBe("1.00");
  });
});

describe("money — formatINR with Indian digit grouping (NFR-14)", () => {
  it("groups the last 3 digits then in pairs, prefixes ₹, 2dp", () => {
    expect(formatINR("124999")).toBe("₹1,24,999.00");
    expect(formatINR("999")).toBe("₹999.00");
    expect(formatINR("1000")).toBe("₹1,000.00");
    expect(formatINR("100000")).toBe("₹1,00,000.00");
    expect(formatINR("10000000")).toBe("₹1,00,00,000.00");
    expect(formatINR("1234.5")).toBe("₹1,234.50");
    expect(formatINR("-24999")).toBe("-₹24,999.00");
    expect(formatINR("0")).toBe("₹0.00");
  });
});

/**
 * FRD §5.4.1 (six standard brochure prices) + §5.4.2 (four combo prices) —
 * every figure is GST-inclusive at 18%. For each we assert:
 *  - base + gst reconciles EXACTLY to the inclusive standard fee, and
 *  - applyGst(extractBase(x)) round-trips back to x at 2dp.
 */
const INCLUSIVE_PRICES: { label: string; inclusive: string; base: string; gst: string }[] = [
  // §5.4.1 standard
  { label: "Data Analyst / Advanced", inclusive: "24999", base: "21185.59", gst: "3813.41" },
  { label: "Data Analyst / Premium", inclusive: "74999", base: "63558.47", gst: "11440.53" },
  { label: "Adv DS & AI / Advanced", inclusive: "29999", base: "25422.88", gst: "4576.12" },
  { label: "Adv DS & AI / Premium", inclusive: "79999", base: "67795.76", gst: "12203.24" },
  { label: "Agentic AI / Advanced", inclusive: "34999", base: "29660.17", gst: "5338.83" },
  { label: "Agentic AI / Premium", inclusive: "89999", base: "76270.34", gst: "13728.66" },
  // §5.4.2 combo
  { label: "Combo / Advanced Double", inclusive: "34999", base: "29660.17", gst: "5338.83" },
  { label: "Combo / Advanced Single", inclusive: "31999", base: "27117.80", gst: "4881.20" },
  { label: "Combo / Premium Double", inclusive: "89999", base: "76270.34", gst: "13728.66" },
  { label: "Combo / Premium Single", inclusive: "84999", base: "72033.05", gst: "12965.95" },
];

describe("money — GST extraction on every brochure & combo price (FRD 5.4.1/5.4.2)", () => {
  for (const p of INCLUSIVE_PRICES) {
    it(`${p.label}: ₹${p.inclusive} inclusive → base ${p.base} + gst ${p.gst}`, () => {
      const { baseFee, gstAmount, standardFee } = decomposeInclusive(p.inclusive, 18);
      expect(s(baseFee)).toBe(p.base);
      expect(s(gstAmount)).toBe(p.gst);
      expect(s(standardFee)).toBe(`${p.inclusive}.00`);
      // components reconcile exactly to the inclusive figure
      expect(s(round(add(baseFee, gstAmount)))).toBe(`${p.inclusive}.00`);
    });

    it(`${p.label}: applyGst(extractBase(x)) round-trips to ₹${p.inclusive}.00`, () => {
      const base = extractBase(p.inclusive, 18);
      expect(s(round(applyGst(base, 18)))).toBe(`${p.inclusive}.00`);
    });
  }

  it("extractBase(24999,18) then applyGst reverses to 24999.00 (verify example)", () => {
    expect(s(round(applyGst(extractBase(money("24999"), 18), 18)))).toBe("24999.00");
  });
});

describe("money — calculateBalance (BR-22): only APPROVED, non-voided payments count", () => {
  const payments: BalancePayment[] = [
    { receivedAmount: "10000", auditStatus: AuditStatus.APPROVED, voided: false },
    { receivedAmount: "5000", auditStatus: AuditStatus.PENDING_AUDIT, voided: false },
    { receivedAmount: "5000", auditStatus: AuditStatus.REJECTED, voided: false },
    { receivedAmount: "5000", auditStatus: AuditStatus.CORRECTION_REQUIRED, voided: false },
    { receivedAmount: "5000", auditStatus: AuditStatus.RESUBMITTED, voided: false },
    { receivedAmount: "9999", auditStatus: AuditStatus.APPROVED, voided: true }, // voided → ignored
  ];

  it("ignores PENDING, REJECTED, CORRECTION_REQUIRED, RESUBMITTED and voided", () => {
    // Only the single approved, non-voided 10000 reduces the 24999 fee.
    expect(s(calculateBalance("24999", payments))).toBe("14999.00");
  });

  it("empty payment list → balance equals the full fee", () => {
    expect(s(calculateBalance("24999", []))).toBe("24999.00");
  });

  it("fully paid (approved sum == fee) → balance 0.00", () => {
    const full: BalancePayment[] = [
      { receivedAmount: "20000", auditStatus: AuditStatus.APPROVED, voided: false },
      { receivedAmount: "4999", auditStatus: AuditStatus.APPROVED, voided: false },
    ];
    expect(s(calculateBalance("24999", full))).toBe("0.00");
  });
});

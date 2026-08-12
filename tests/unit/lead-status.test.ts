import { describe, expect, it } from "vitest";
import { LeadStatus, AuditStatus } from "@prisma/client";
import { computeLeadStatus, STATUS_ORDER, statusRank } from "@/server/services/lead-status";

const approved = (paymentNumber: number, receivedAmount: string) => ({
  paymentNumber, auditStatus: AuditStatus.APPROVED, voided: false, receivedAmount,
});

describe("computeLeadStatus — advances in FRD §3.4 order, never skips", () => {
  const base = { interested: false, basicDetailsComplete: false, draftGenerated: false, finalApprovedFee: null, payments: [] as ReturnType<typeof approved>[] };

  it("new lead (not interested) → NEW_LEAD", () => {
    expect(computeLeadStatus(base)).toBe(LeadStatus.NEW_LEAD);
  });
  it("interested, no details → BASIC_DETAILS_PENDING", () => {
    expect(computeLeadStatus({ ...base, interested: true })).toBe(LeadStatus.BASIC_DETAILS_PENDING);
  });
  it("basic details complete → BASIC_DETAILS_RECEIVED", () => {
    expect(computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true })).toBe(LeadStatus.BASIC_DETAILS_RECEIVED);
  });
  it("draft generated → PAYMENT_DRAFT_GENERATED", () => {
    expect(computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true })).toBe(LeadStatus.PAYMENT_DRAFT_GENERATED);
  });
  it("draft shared → PAYMENT_PENDING", () => {
    expect(computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true, draftShared: true })).toBe(LeadStatus.PAYMENT_PENDING);
  });
  it("payment 1 approved, balance outstanding → DOWN_PAYMENT_PENDING", () => {
    expect(computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true, finalApprovedFee: "24999", payments: [approved(1, "10000")] })).toBe(LeadStatus.DOWN_PAYMENT_PENDING);
  });
  it("payment 2 approved, balance outstanding → FINAL_PAYMENT_PENDING", () => {
    expect(computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true, finalApprovedFee: "24999", payments: [approved(1, "10000"), approved(2, "10000")] })).toBe(LeadStatus.FINAL_PAYMENT_PENDING);
  });
  it("fully paid → FULLY_PAID", () => {
    expect(computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true, finalApprovedFee: "24999", payments: [approved(1, "14999"), approved(2, "10000")] })).toBe(LeadStatus.FULLY_PAID);
  });
  it("fully paid + records complete → ENROLLMENT_COMPLETED", () => {
    expect(computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, finalApprovedFee: "24999", payments: [approved(1, "24999")], enrollmentComplete: true })).toBe(LeadStatus.ENROLLMENT_COMPLETED);
  });
  it("handed to operations → OPERATIONS_HANDOVER", () => {
    expect(computeLeadStatus({ ...base, interested: true, operationsHandover: true })).toBe(LeadStatus.OPERATIONS_HANDOVER);
  });

  it("the emitted sequence is strictly increasing in FRD order (never skips backward)", () => {
    const sequence = [
      computeLeadStatus(base),
      computeLeadStatus({ ...base, interested: true }),
      computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true }),
      computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true }),
      computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true, draftShared: true }),
      computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true, finalApprovedFee: "24999", payments: [approved(1, "10000")] }),
      computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, draftGenerated: true, finalApprovedFee: "24999", payments: [approved(1, "10000"), approved(2, "5000")] }),
      computeLeadStatus({ ...base, interested: true, basicDetailsComplete: true, finalApprovedFee: "24999", payments: [approved(1, "24999")] }),
    ];
    const ranks = sequence.map(statusRank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
    expect(STATUS_ORDER).toHaveLength(13);
  });
});

describe("computeLeadStatus — only APPROVED payments advance the pipeline (BR-22)", () => {
  it("a PENDING payment does not advance past the draft state", () => {
    const s = computeLeadStatus({
      interested: true, basicDetailsComplete: true, draftGenerated: true, finalApprovedFee: "24999",
      payments: [{ paymentNumber: 1, auditStatus: AuditStatus.PENDING_AUDIT, voided: false, receivedAmount: "10000" }],
    });
    expect(s).toBe(LeadStatus.PAYMENT_DRAFT_GENERATED);
  });
  it("a REJECTED payment does not advance", () => {
    const s = computeLeadStatus({
      interested: true, basicDetailsComplete: true, draftGenerated: true, finalApprovedFee: "24999",
      payments: [{ paymentNumber: 1, auditStatus: AuditStatus.REJECTED, voided: false, receivedAmount: "10000" }],
    });
    expect(s).toBe(LeadStatus.PAYMENT_DRAFT_GENERATED);
  });
});

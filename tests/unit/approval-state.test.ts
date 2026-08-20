/**
 * The approval chip a salesperson reads at a glance.
 *
 * The ordering is the point: anything bounced BACK to Sales must win over progress further
 * down the chain, because it is the only state where they owe work. A lead showing
 * "Approved by Nandhiya" while a payment sits in CORRECTION_REQUIRED would quietly hide the
 * one thing they need to do.
 */
import { describe, expect, it } from "vitest";
import { AuditStatus } from "@prisma/client";
import { computeApprovalState, APPROVAL_LABEL } from "@/server/services/lead-status";

const p = (auditStatus: AuditStatus, voided = false) => ({ auditStatus, voided });

describe("computeApprovalState", () => {
  it("nothing captured yet → Not submitted", () => {
    expect(computeApprovalState({ payments: [], handoverStage: null, financeReturned: false })).toBe("NOT_SUBMITTED");
  });

  it("payment captured, not handed over → Awaiting Nandhiya", () => {
    expect(
      computeApprovalState({ payments: [p(AuditStatus.PENDING_AUDIT)], handoverStage: null, financeReturned: false }),
    ).toBe("AWAITING_AUDIT");
  });

  it("handed over, still with her → Pending with Nandhiya", () => {
    expect(
      computeApprovalState({ payments: [p(AuditStatus.PENDING_AUDIT)], handoverStage: "WITH_DATA_MGMT", financeReturned: false }),
    ).toBe("WITH_DATA_MGMT");
  });

  it("she approved and passed it on → Approved by Nandhiya", () => {
    expect(
      computeApprovalState({ payments: [p(AuditStatus.APPROVED)], handoverStage: "WITH_FINANCE", financeReturned: false }),
    ).toBe("APPROVED_BY_DATA_MGMT");
  });

  it("Rajesh signed it off → Approved by Finance", () => {
    expect(
      computeApprovalState({ payments: [p(AuditStatus.APPROVED)], handoverStage: "FINANCE_APPROVED", financeReturned: false }),
    ).toBe("APPROVED_BY_FINANCE");
  });

  it("Finance sent it back → that outranks the stage it landed in", () => {
    expect(
      computeApprovalState({ payments: [p(AuditStatus.APPROVED)], handoverStage: "WITH_DATA_MGMT", financeReturned: true }),
    ).toBe("RETURNED_BY_FINANCE");
  });

  it("a correction outranks EVERYTHING — it is the only state Sales can act on", () => {
    expect(
      computeApprovalState({
        payments: [p(AuditStatus.APPROVED), p(AuditStatus.CORRECTION_REQUIRED)],
        handoverStage: "FINANCE_APPROVED",
        financeReturned: false,
      }),
    ).toBe("CORRECTION_REQUIRED");
  });

  it("a rejected payment likewise surfaces over progress", () => {
    expect(
      computeApprovalState({
        payments: [p(AuditStatus.APPROVED), p(AuditStatus.REJECTED)],
        handoverStage: "WITH_FINANCE",
        financeReturned: false,
      }),
    ).toBe("PAYMENT_REJECTED");
  });

  it("a VOIDED rejection is history, not a live problem", () => {
    expect(
      computeApprovalState({
        payments: [p(AuditStatus.APPROVED), p(AuditStatus.REJECTED, true)],
        handoverStage: "WITH_FINANCE",
        financeReturned: false,
      }),
    ).toBe("APPROVED_BY_DATA_MGMT");
  });

  it("every state has wording — no raw enum can reach a screen", () => {
    const states = [
      "NOT_SUBMITTED", "CORRECTION_REQUIRED", "PAYMENT_REJECTED", "RETURNED_BY_FINANCE",
      "AWAITING_AUDIT", "WITH_DATA_MGMT", "APPROVED_BY_DATA_MGMT", "APPROVED_BY_FINANCE",
    ] as const;
    for (const s of states) {
      expect(APPROVAL_LABEL[s], s).toBeTruthy();
      expect(APPROVAL_LABEL[s]).not.toMatch(/_/);
    }
  });
});

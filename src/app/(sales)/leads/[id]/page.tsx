import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { getLeadForActor } from "@/server/services/leads";
import { draftGenerationBlockers, listDraftVersions, getDraftConfig } from "@/server/services/draft";
import { listPaymentsForLead } from "@/server/services/payments";
import { AuthorizationError, hasPermission } from "@/server/auth/permissions";
import { LeadDetailClient, type LeadDetail } from "./lead-detail-client";
import { DraftPanel } from "./draft-panel";
import { PaymentPanel } from "./payment-panel";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireRoles([Role.SALESPERSON, Role.SALES_MANAGER]);
  const { id } = await params;

  let lead;
  try {
    lead = await getLeadForActor(actor, id);
  } catch (e) {
    if (e instanceof AuthorizationError) notFound(); // refuse without leaking existence
    throw e;
  }

  const e = lead.enrollment;
  const detail: LeadDetail = {
    id: lead.id,
    fullName: lead.fullName,
    dob: lead.dob?.toISOString() ?? null,
    doorNo: lead.doorNo,
    street: lead.street,
    address: lead.address,
    district: lead.district,
    state: lead.state,
    pincode: lead.pincode,
    email: lead.email,
    mobile: lead.mobile,
    leadSource: lead.leadSource,
    remarks: lead.remarks,
    status: lead.status,
    enrollment: e
      ? {
          program: e.program,
          plan: e.plan,
          comboMode: e.comboMode,
          commencingDate: e.commencingDate?.toISOString() ?? null,
          batch: e.batch,
          courseStartedFlag: e.courseStartedFlag,
          standardFee: e.standardFee?.toFixed(2) ?? null,
          baseFee: e.baseFee?.toFixed(2) ?? null,
          gstAmount: e.gstAmount?.toFixed(2) ?? null,
          gstPercent: e.gstPercent?.toFixed(2) ?? "18",
          concessionAmount: e.concessionAmount.toFixed(2),
          concessionReason: e.concessionReason,
          concessionStatus: e.concessionStatus,
          finalApprovedFee: e.finalApprovedFee?.toFixed(2) ?? null,
          feeLocked: Boolean(e.feeLockedAt),
        }
      : null,
  };

  const [blockers, versions, config, paymentData] = await Promise.all([
    draftGenerationBlockers(id, actor),
    listDraftVersions(actor, id),
    getDraftConfig(),
    listPaymentsForLead(actor, id),
  ]);

  return (
    <div className="space-y-6">
      <LeadDetailClient
        lead={detail}
        canApproveConcession={hasPermission(actor.role, "concession:approve")}
      />
      {detail.enrollment?.standardFee && (
        <DraftPanel
          leadId={id}
          blockers={blockers}
          versions={versions}
          whatsappEnabled={config.whatsappEnabled}
          learnerMobile={detail.mobile}
        />
      )}
      {detail.enrollment?.feeLocked && (
        <PaymentPanel
          leadId={id}
          payments={paymentData.payments}
          balance={paymentData.balance}
          finalApprovedFee={paymentData.finalApprovedFee}
        />
      )}
    </div>
  );
}

import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { getAuditRecord, auditTimeline, AuditError } from "@/server/services/audit-decisions";
import { listReasonCodes } from "@/server/services/pricing-admin";
import { AuditRecordClient } from "./audit-record-client";

export default async function AuditRecordPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { actor } = await requireRoles([Role.DATA_MGMT_AUDITOR]);
  const { paymentId } = await params;

  let record, timeline;
  try {
    [record, timeline] = await Promise.all([getAuditRecord(actor, paymentId), auditTimeline(actor, paymentId)]);
  } catch (e) {
    if (e instanceof AuditError) notFound();
    throw e;
  }
  const reasonCodes = await listReasonCodes();

  return <AuditRecordClient record={record} timeline={timeline} reasonCodes={reasonCodes} />;
}

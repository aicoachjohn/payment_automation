import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { getAuditRecord, auditTimeline, AuditError } from "@/server/services/audit-decisions";
import { listReasonCodes } from "@/server/services/pricing-admin";
import { db } from "@/server/db";
import { buildHandoverSnapshot } from "@/server/services/handover";
import { PassToFinance } from "@/app/handover/pass-to-finance";
import { AuditRecordClient } from "./audit-record-client";

export const dynamic = "force-dynamic";

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

  // The handover for THIS learner, so Nandhiya approves and passes it on without leaving the
  // record. Blockers are computed live rather than read from the snapshot, because she will
  // have just decided on a payment — the button must open the moment her desk is clear.
  const handover = await db.operationsHandover.findFirst({
    where: { enrollmentId: record.enrollmentId },
    orderBy: { createdAt: "desc" },
  });
  const snapshot = handover ? await buildHandoverSnapshot(record.enrollmentId) : null;

  return (
    <div className="space-y-6">
      <AuditRecordClient record={record} timeline={timeline} reasonCodes={reasonCodes} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Handover</h2>
          {handover && (
            <Link href={`/handover/${handover.id}`} className="text-sm text-brand-blue hover:underline">
              View the full consolidated record →
            </Link>
          )}
        </div>

        {!handover && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Sales have not handed this learner over yet. Once they do, you can pass it to Finance from here.
          </p>
        )}

        {handover?.stage === "WITH_DATA_MGMT" && snapshot && (
          <>
            {handover.financeRejectionReason && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                <strong>Finance sent this back.</strong> {handover.financeRejectionReason}
              </div>
            )}
            <PassToFinance handoverId={handover.id} blockers={snapshot.dataMgmtMissing} />
          </>
        )}

        {handover?.stage === "WITH_FINANCE" && (
          <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
            <strong>Handed over to Rajesh (Finance).</strong> Waiting on his sign-off.
          </p>
        )}

        {handover?.stage === "FINANCE_APPROVED" && (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <strong>Approved by Finance.</strong> This learner is fully signed off.
          </p>
        )}
      </section>
    </div>
  );
}

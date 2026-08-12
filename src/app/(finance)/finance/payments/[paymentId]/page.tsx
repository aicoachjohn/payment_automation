import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { financePaymentDetail } from "@/server/services/finance";
import { auditTimeline } from "@/server/services/audit-decisions";
import { formatINR, formatDate } from "@/lib/format";
import { ProofViewer } from "@/components/shared/proof-viewer";
import { RaiseQueryForm } from "./raise-query-form";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  PENDING_AUDIT: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  CORRECTION_REQUIRED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  RESUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export default async function FinancePaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { actor } = await requireRoles([Role.FINANCE_REVIEWER]);
  const { paymentId } = await params;
  const [detail, timeline] = await Promise.all([
    financePaymentDetail(actor, paymentId),
    auditTimeline(actor, paymentId),
  ]);
  if (!detail) notFound();

  return (
    <section className="space-y-6">
      <div>
        <Link href="/finance" className="text-sm text-sky-600 hover:underline">← Back to statement</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
          {detail.learnerName}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[detail.auditStatus] ?? ""}`}>
            {detail.auditStatus.replace(/_/g, " ")}
          </span>
        </h1>
        {!detail.countedInTotals && (
          <p className="mt-1 text-sm text-slate-500">
            This payment is <strong>not approved</strong>, so it is excluded from every Finance total. It is shown
            here only for transparency (FR-FIN-09).
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
        <Field label="Program">{detail.program}</Field>
        <Field label="Plan">{detail.plan}</Field>
        <Field label="Payment Type">{detail.paymentType} · #{detail.paymentNumber}</Field>
        <Field label="Expected">{formatINR(detail.expectedAmount)}</Field>
        <Field label="Received">{formatINR(detail.receivedAmount)}</Field>
        <Field label="Payment Date">{formatDate(detail.paymentDate)}</Field>
        <Field label="Method">{detail.paymentMethod}</Field>
        <Field label="Transaction ID">{detail.transactionId}</Field>
        <Field label="Salesperson">{detail.salesperson}</Field>
        <Field label="Approved By">{detail.approvedBy ?? "—"}</Field>
        <Field label="Approval Date">{detail.approvedAt ? formatDate(detail.approvedAt) : "—"}</Field>
        <Field label="Proof">{detail.proofId ? <ProofViewer proofId={detail.proofId} /> : "—"}</Field>
      </dl>

      {/* Read-only audit history (FR-FIN-09) */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Audit history</h2>
        <ol className="space-y-2">
          {timeline.length === 0 && <li className="text-sm text-slate-500">No audit entries yet.</li>}
          {timeline.map((e) => (
            <li key={e.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                <span className="text-xs text-slate-500">{formatDate(e.at)} · {e.byName} ({e.role})</span>
              </div>
              {e.field && (
                <div className="mt-1 text-xs text-slate-500">
                  {e.field}: {e.oldValue ?? "—"} → {e.newValue ?? "—"}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      {detail.canRaiseQuery ? (
        <RaiseQueryForm paymentId={detail.id} />
      ) : (
        <p className="text-sm text-slate-500">A Finance Query can only be raised against an approved payment.</p>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

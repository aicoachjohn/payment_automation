import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { financePaymentDetail } from "@/server/services/finance";
import { paymentProofVersions } from "@/server/services/admin-console";
import { auditTimeline } from "@/server/services/audit-decisions";
import { formatINR, formatDate } from "@/lib/format";
import { DELEGATED_AUDIT_LABEL } from "@/lib/constants";
import { ProofViewer } from "@/components/shared/proof-viewer";

export const dynamic = "force-dynamic";

export default async function AdminRecordPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { actor } = await requireRoles([Role.SUPER_ADMIN]);
  const { paymentId } = await params;
  const [detail, proofs, timeline] = await Promise.all([
    financePaymentDetail(actor, paymentId),
    paymentProofVersions(actor, paymentId),
    auditTimeline(actor, paymentId),
  ]);
  if (!detail) notFound();

  return (
    <section className="space-y-6">
      <div>
        <Link href="/admin/records" className="text-sm text-sky-600 hover:underline">← Back to records</Link>
        <h1 className="mt-1 text-2xl font-semibold">{detail.learnerName}</h1>
        <p className="text-sm text-slate-500">
          {detail.transactionId} · {detail.auditStatus.replace(/_/g, " ")}
          {detail.delegatedAudit && (
            <span className="ml-2 rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-300">{DELEGATED_AUDIT_LABEL}</span>
          )}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
        <Field label="Program">{detail.program} · {detail.plan}</Field>
        <Field label="Payment">{detail.paymentType} #{detail.paymentNumber}</Field>
        <Field label="Received">{formatINR(detail.receivedAmount)}</Field>
        <Field label="Payment date">{formatDate(detail.paymentDate)}</Field>
        <Field label="Method">{detail.paymentMethod}</Field>
        <Field label="Counted in Finance">{detail.countedInTotals ? "Yes (approved)" : "No"}</Field>
        <Field label="Approved by">{detail.approvedBy ?? "—"}{detail.delegatedAudit ? " (delegated)" : ""}</Field>
        <Field label="Salesperson">{detail.salesperson}</Field>
      </dl>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Proof versions ({proofs.length})</h2>
        <ul className="space-y-2">
          {proofs.length === 0 && <li className="text-sm text-slate-500">No proof uploaded.</li>}
          {proofs.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
              <span className="font-medium">v{p.version}</span>
              <span className="text-slate-500">{p.originalFilename}</span>
              <span className="text-xs text-slate-400">{formatDate(p.uploadedAt)}</span>
              <span className="ml-auto"><ProofViewer proofId={p.id} label={`View v${p.version}`} /></span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Complete audit history</h2>
        <ol className="space-y-2">
          {timeline.length === 0 && <li className="text-sm text-slate-500">No audit entries.</li>}
          {timeline.map((e) => (
            <li key={e.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                <span className="text-xs text-slate-500">{formatDate(e.at)} · {e.byName} ({e.role})</span>
              </div>
              {e.field && <div className="mt-1 text-xs text-slate-500">{e.field}: {e.oldValue ?? "—"} → {e.newValue ?? "—"}</div>}
            </li>
          ))}
        </ol>
      </div>
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

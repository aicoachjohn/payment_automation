import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { traceCollection, traceEnrollment } from "@/server/services/reconciliation";
import { formatINR, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Trace-this-number (FR-REC-16): every figure on any dashboard traces back to the exact
 * approved payment rows that produced it. Reached by clicking a total (period → from/to)
 * or a balance (enrollmentId).
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requireRoles([Role.FINANCE_REVIEWER]);
  const sp = await searchParams;

  if (sp.enrollmentId) {
    const t = await traceEnrollment(actor, sp.enrollmentId);
    return (
      <Layout title="Trace — enrollment balance">
        <p className="text-sm text-slate-500">
          Final approved fee <strong>{formatINR(t.finalApprovedFee)}</strong> − total received <strong>{formatINR(t.totalReceived)}</strong> = balance <strong>{formatINR(t.balance)}</strong>. The approved payments below are the exact rows behind that number.
        </p>
        <TraceTable rows={t.rows} total={t.totalReceived} />
      </Layout>
    );
  }

  const from = sp.from || new Date().toISOString().slice(0, 10);
  const to = sp.to || from;
  const t = await traceCollection(actor, { from, to, paymentType: sp.paymentType });
  return (
    <Layout title="Trace — collection total">
      <p className="text-sm text-slate-500">
        Period {from} to {to}{sp.paymentType ? ` · ${sp.paymentType}` : ""}. These {t.rows.length} approved payment(s) sum to <strong>{formatINR(t.total)}</strong>.
      </p>
      <TraceTable rows={t.rows} total={t.total} />
    </Layout>
  );
}

function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <Link href="/finance" className="text-sm text-sky-600 hover:underline">← Back to Finance</Link>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      </div>
      {children}
    </section>
  );
}

function TraceTable({ rows, total }: { rows: { id: string; learner: string; transactionId: string; paymentType: string; receivedAmount: string; paymentDate: string; approvedAt: string | null }[]; total: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
          <tr><th className="px-3 py-2">Learner</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Received</th><th className="px-3 py-2">Payment date</th><th className="px-3 py-2">Txn ID</th><th className="px-3 py-2">Approved</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No payments behind this figure.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-3 py-2">{r.learner}</td>
              <td className="px-3 py-2">{r.paymentType}</td>
              <td className="px-3 py-2 font-mono">{formatINR(r.receivedAmount)}</td>
              <td className="px-3 py-2">{formatDate(r.paymentDate)}</td>
              <td className="px-3 py-2">{r.transactionId}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{r.approvedAt ? formatDate(r.approvedAt) : "—"}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-700">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 font-mono">{formatINR(total)}</td>
              <td colSpan={3} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { listExceptions, orphanReport, monthEndStatement, monthlyExceptionsReport } from "@/server/services/reconciliation";
import { formatINR, formatDate } from "@/lib/format";
import { RunReconciliation, ExceptionActions } from "./reconciliation-client";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requireRoles([Role.SUPER_ADMIN]);
  const sp = await searchParams;
  const now = new Date();
  const year = sp.year ? Number(sp.year) : now.getUTCFullYear();
  const month = sp.month ? Number(sp.month) : now.getUTCMonth() + 1;

  const [exceptions, orphans, statement, monthly] = await Promise.all([
    listExceptions(actor),
    orphanReport(actor),
    monthEndStatement(actor, year, month),
    monthlyExceptionsReport(actor, year, month),
  ]);
  const orphanTotal = orphans.paymentsWithoutProof.length + orphans.approvedWithoutAuditEntry.length + orphans.paymentsOnVoidedLead.length;

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Reconciliation</h1>
        <p className="text-sm text-slate-500">
          Prevention is the first line; this surfaces any drift the same day. Every figure recomputes from the
          individual approved records (FR-REC-11..18).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <RunReconciliation />
        <form method="GET" className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">Month
            <select name="month" defaultValue={month} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">Year
            <input name="year" type="number" defaultValue={year} className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
          </label>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">View</button>
        </form>
      </div>

      {/* Exceptions (FR-REC-12) */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Exceptions</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Detail</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Raised</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {exceptions.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No exceptions. The books reconcile.</td></tr>}
              {exceptions.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                  <td className="px-3 py-2 font-medium">{e.kind}</td>
                  <td className="px-3 py-2">{e.detail}{e.enrollmentId && <> · <Link href={`/finance/trace?enrollmentId=${e.enrollmentId}`} className="text-sky-600 hover:underline">trace</Link></>}</td>
                  <td className="px-3 py-2">{e.status}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{formatDate(e.raisedAt)}</td>
                  <td className="px-3 py-2"><ExceptionActions ex={e} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Orphan report (FR-REC-14) */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Orphan records <span className="text-sm font-normal text-slate-500">({orphanTotal})</span></h2>
        <div className="grid gap-3 md:grid-cols-3">
          <OrphanCard title="Payments without a proof" rows={orphans.paymentsWithoutProof} />
          <OrphanCard title="Approved with no audit entry" rows={orphans.approvedWithoutAuditEntry} />
          <OrphanCard title="Approved on a voided lead" rows={orphans.paymentsOnVoidedLead} />
        </div>
      </div>

      {/* Month-end statement (FR-REC-15) */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Month-end statement — {MONTHS[month - 1]} {year}</h2>
        <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
          <Line k="Opening outstanding" v={formatINR(statement.openingOutstanding)} />
          {statement.approvedByType.map((t) => (
            <Line key={t.type} k={`Approved — ${t.type} (${t.count})`} v={formatINR(t.value)} indent />
          ))}
          <Line k="Approved in period" v={formatINR(statement.approvedInPeriod)} strong />
          <Line k={`Voids & reversals (${statement.voidsInPeriod.count})`} v={formatINR(statement.voidsInPeriod.value)} />
          <Line k="Closing outstanding" v={formatINR(statement.closingOutstanding)} strong />
          <p className="mt-2 text-xs text-slate-500">
            {statement.reconciles ? "✓ Opening − approved = closing, to the paisa." : "⚠ Statement does not reconcile."}
            {" "}<Link href={`/finance/trace?from=${year}-${String(month).padStart(2, "0")}-01&to=${year}-${String(month).padStart(2, "0")}-28`} className="text-sky-600 hover:underline">trace the collection →</Link>
          </p>
        </div>
      </div>

      {/* Monthly exceptions report to Rajesh (FR-REC-17) */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Monthly exceptions report — {MONTHS[month - 1]} {year}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <ReportCard title={`Approved outside working hours (${monthly.approvedOutsideHours.length})`}>
            {monthly.approvedOutsideHours.map((r) => <li key={r.id}>{r.learner} · {r.transactionId} · {r.istHour}:00 IST</li>)}
          </ReportCard>
          <ReportCard title={`Super Admin money overrides (${monthly.moneyOverrides.length})`}>
            {monthly.moneyOverrides.map((r) => <li key={r.id}>{r.overrideType} · {r.reason}</li>)}
          </ReportCard>
          <ReportCard title={`Voided payments (${monthly.voidedPayments.length})`}>
            {monthly.voidedPayments.map((r) => <li key={r.id}>{r.learner} · {r.transactionId}{r.reason ? ` · ${r.reason}` : ""}</li>)}
          </ReportCard>
        </div>
      </div>
    </section>
  );
}

function OrphanCard({ title, rows }: { title: string; rows: { id: string; transactionId: string; learner: string }[] }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${rows.length > 0 ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" : "border-slate-200 dark:border-slate-800"}`}>
      <h3 className="mb-1 font-semibold">{title} ({rows.length})</h3>
      <ul className="space-y-0.5 text-xs">
        {rows.length === 0 && <li className="text-slate-500">None.</li>}
        {rows.map((r) => <li key={r.id}>{r.learner} · {r.transactionId}</li>)}
      </ul>
    </div>
  );
}

function ReportCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">{children}</ul>
    </div>
  );
}

function Line({ k, v, indent, strong }: { k: string; v: string; indent?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between border-b border-slate-100 py-1 last:border-0 dark:border-slate-800 ${indent ? "pl-4 text-slate-500" : ""} ${strong ? "font-semibold" : ""}`}>
      <span>{k}</span><span className="font-mono">{v}</span>
    </div>
  );
}

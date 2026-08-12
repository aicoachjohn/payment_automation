import Link from "next/link";
import { Role, AuditStatus, PaymentType } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { auditDashboard, auditQueue } from "@/server/services/audit-decisions";
import { formatINR } from "@/lib/format";
import { AuditQueueClient } from "./audit-queue-client";

const STATUS_LABEL: Record<string, string> = {
  PENDING_AUDIT: "Pending", APPROVED: "Approved", CORRECTION_REQUIRED: "Correction", REJECTED: "Rejected", RESUBMITTED: "Resubmitted",
};

export default async function AuditHome({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; paymentType?: string; search?: string }>;
}) {
  const { user, actor } = await requireRoles([Role.DATA_MGMT_AUDITOR]);
  const sp = await searchParams;
  const filters = {
    status: sp.status as AuditStatus | undefined,
    paymentType: sp.paymentType as PaymentType | undefined,
    search: sp.search || undefined,
  };
  const [dash, rows] = await Promise.all([auditDashboard(actor), auditQueue(actor, filters)]);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Data Management — L1 Audit</h1>
        <p className="text-sm text-slate-500">
          Welcome, {user.name}. Every payment passes through here before Finance can see it.
          {dash.ageing.amber > 0 && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 text-amber-800">{dash.ageing.amber} ageing</span>
          )}
          {dash.ageing.red > 0 && (
            <span className="ml-1 rounded bg-red-100 px-1.5 text-red-700">{dash.ageing.red} overdue</span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {dash.tiles.map((t) => (
          <Link
            key={t.key}
            href={`/audit?status=${t.label}`}
            className={`rounded-lg border p-4 hover:shadow-sm ${t.label === "PENDING_AUDIT" || t.label === "RESUBMITTED" ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" : "border-slate-200 dark:border-slate-800"}`}
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">{STATUS_LABEL[t.label] ?? t.label}</div>
            <div className="mt-1 text-2xl font-semibold">{t.count}</div>
            <div className="text-xs text-slate-500">{formatINR(t.total)}</div>
          </Link>
        ))}
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Search
          <input name="search" defaultValue={sp.search ?? ""} placeholder="Lead, mobile, email, Txn ID" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Status
          <select name="status" defaultValue={sp.status ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.values(AuditStatus).map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Payment type
          <select name="paymentType" defaultValue={sp.paymentType ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.values(PaymentType).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Filter</button>
        <Link href="/audit" className="text-sm text-slate-500 hover:underline">Clear</Link>
        <a href={`/api/audit/export?${query}`} className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Export CSV</a>
      </form>

      <AuditQueueClient rows={rows} />
    </section>
  );
}

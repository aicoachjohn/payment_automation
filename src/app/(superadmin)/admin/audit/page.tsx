import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { searchAuditTrail, auditFilterOptions, type AuditLogFilters } from "@/server/services/audit-log";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditTrailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requireRoles([Role.SUPER_ADMIN]);
  const sp = await searchParams;
  const filters: AuditLogFilters = {
    entityType: sp.entityType || undefined,
    action: sp.action || undefined,
    entityId: sp.entityId || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  };
  const [rows, options] = await Promise.all([searchAuditTrail(actor, filters), auditFilterOptions(actor)]);
  const exportQuery = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System-Wide Audit Trail</h1>
        <p className="text-sm text-slate-500">
          Every state-changing action, append-only and retained for at least 7 years (FR-AUD-01/03). Searchable and
          exportable (FR-ADM-10, FR-AUD-04). No one — not even the Super Admin — can edit or delete an entry.
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Entity
          <select name="entityType" defaultValue={sp.entityType ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {options.entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Action
          <select name="action" defaultValue={sp.action ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {options.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Entity ID
          <input name="entityId" defaultValue={sp.entityId ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">From
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">To
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Search</button>
        <Link href="/admin/audit" className="inline-flex min-h-[44px] items-center text-sm text-slate-500 hover:underline sm:min-h-0">Clear</Link>
        <a href={`/api/admin/audit/export?${exportQuery}`} className="inline-flex min-h-[44px] items-center sm:min-h-0 ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Export CSV</a>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Old → New</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No matching audit entries.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-2">{formatDate(r.at)}</td>
                <td className="px-3 py-2">{r.byName} <span className="text-xs text-slate-400">({r.role})</span></td>
                <td className="px-3 py-2">{r.action}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.entityType} · {r.entityId.slice(0, 10)}…</td>
                <td className="px-3 py-2">{r.field ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.field ? <span>{r.oldValue ?? "∅"} → {r.newValue ?? "∅"}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Showing up to 500 most-recent matching entries. Export for the full filtered set.</p>
    </section>
  );
}

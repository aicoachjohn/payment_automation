import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { listSuperAdminActivity, overrideSummary } from "@/server/services/overrides";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  REVERSE_AUDIT: "Audit reversal", UNLOCK_FEE: "Fee unlock", REASSIGN_LEAD: "Lead reassignment",
  APPROVE_CONCESSION: "Concession approval", EXTEND_DEADLINE: "Deadline extension",
  REVERSE_OPS_TRANSFER: "Ops transfer reversal", DELEGATED_AUDIT: "Delegated audit",
};

export default async function ActivityLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requireRoles([Role.SUPER_ADMIN]);
  const sp = await searchParams;
  const now = new Date();
  const year = sp.year ? Number(sp.year) : now.getUTCFullYear();
  const month = sp.month ? Number(sp.month) : now.getUTCMonth() + 1;

  const [rows, summary] = await Promise.all([
    listSuperAdminActivity(actor, {}),
    overrideSummary(actor, year, month),
  ]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Super Admin Activity Log</h1>
        <p className="text-sm text-slate-500">
          A dedicated, immutable record of every override (FR-SA-16). This same log is visible to Rajesh in read-only
          form (FR-SA-17) — the most powerful account is also the most closely watched.
        </p>
      </div>

      {/* Monthly override summary (FR-SA-19) */}
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-sm font-semibold">Override summary — {month}/{year}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {summary.total} override{summary.total === 1 ? "" : "s"} this month
          {summary.byType.length > 0 && ": "}
          {summary.byType.map((t) => `${TYPE_LABEL[t.type] ?? t.type} (${t.count})`).join(", ")}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Override</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Notified</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No overrides recorded.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-2">{formatDate(r.at)}</td>
                <td className="px-3 py-2">{r.superAdminName}</td>
                <td className="px-3 py-2">{TYPE_LABEL[r.overrideType] ?? r.overrideType}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.entityType} · {r.entityId.slice(0, 10)}…</td>
                <td className="px-3 py-2">{r.reason}</td>
                <td className="px-3 py-2 text-center">{r.notifiedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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

/**
 * FR-SA-17: Rajesh sees the Super Admin Activity Log in READ-ONLY form, so the
 * highest-privilege role stays reviewable by the business. There is no action here — it
 * is a window onto the immutable log, nothing more.
 */
export default async function FinanceOversightPage() {
  const { actor } = await requireRoles([Role.FINANCE_REVIEWER]);
  const now = new Date();
  const [rows, summary] = await Promise.all([
    listSuperAdminActivity(actor, {}),
    overrideSummary(actor, now.getUTCFullYear(), now.getUTCMonth() + 1),
  ]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Super Admin Oversight</h1>
        <p className="text-sm text-slate-500">
          Every Super Admin override, read-only (FR-SA-17). You are notified immediately whenever an approved payment
          is withdrawn, a fee is unlocked, an above-threshold concession is approved, or a delegated audit is performed
          (FR-SA-18).
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-1 text-sm font-semibold">This month</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {summary.total} override{summary.total === 1 ? "" : "s"}
          {summary.byType.length > 0 && ": "}
          {summary.byType.map((t) => `${TYPE_LABEL[t.type] ?? t.type} (${t.count})`).join(", ")}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Override</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No overrides recorded.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-2">{formatDate(r.at)}</td>
                <td className="px-3 py-2">{TYPE_LABEL[r.overrideType] ?? r.overrideType}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.entityType} · {r.entityId.slice(0, 10)}…</td>
                <td className="px-3 py-2">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

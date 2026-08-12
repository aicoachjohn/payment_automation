import Link from "next/link";
import { requireAuth } from "@/server/auth/guard";
import { AppShell } from "@/components/shared/app-shell";
import { ROLE_HOME } from "@/server/auth/permissions";
import { listHandovers } from "@/server/services/handover";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HandoverListPage() {
  const { user, actor } = await requireAuth();
  const rows = await listHandovers(actor);
  return (
    <AppShell user={user} nav={[{ href: ROLE_HOME[user.role], label: "Dashboard" }, { href: "/handover", label: "Handovers" }]}>
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Operations Handovers</h1>
          <p className="text-sm text-slate-500">Consolidated learner/payment records sent to Operations — available to Data Management and Finance (FR-SAL-71).</p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr><th className="px-3 py-2">Learner</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Validated</th><th className="px-3 py-2">Date</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No handovers yet.</td></tr>}
              {rows.map((h) => (
                <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{h.learner}</td>
                  <td className="px-3 py-2">{h.type}</td>
                  <td className="px-3 py-2">{h.validated ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">{h.handoverDate ? formatDate(h.handoverDate) : "—"}</td>
                  <td className="px-3 py-2"><Link href={`/handover/${h.id}`} className="text-sky-600 hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

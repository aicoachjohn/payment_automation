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
          <h1 className="text-2xl font-semibold">Handovers</h1>
          <p className="text-sm text-slate-500">
            Consolidated learner/payment records moving Sales → Data Management → Finance. Open one to see where it is
            and to act on it.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr><th className="px-3 py-2">Learner</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Handed over</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No handovers yet.</td></tr>}
              {rows.map((h) => (
                <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{h.learner}</td>
                  <td className="px-3 py-2"><StageChip stage={h.stage} /></td>
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

const STAGE_LABEL: Record<string, { label: string; cls: string }> = {
  WITH_DATA_MGMT: { label: "With Data Management", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  WITH_FINANCE: { label: "Awaiting Finance sign-off", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  FINANCE_APPROVED: { label: "Approved by Finance", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
};

function StageChip({ stage }: { stage: string }) {
  const s = STAGE_LABEL[stage] ?? { label: stage, cls: "bg-slate-100 text-slate-700" };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

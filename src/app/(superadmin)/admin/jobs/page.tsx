import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatDate } from "@/lib/format";
import { RunJobsButton, SyncSheetsButton } from "./jobs-client";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  await requireRoles([Role.SUPER_ADMIN]);
  const runs = await db.jobRun.findMany({ orderBy: { ranAt: "desc" }, take: 100 });
  const failed = runs.filter((r) => r.status === "FAILED").length;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automation Jobs</h1>
        <p className="text-sm text-slate-500">
          The 15-day rule, reminders, deadline transfers and stale-lead nudges. Each run is idempotent — a UNIQUE key
          per (job, entity, IST date) guarantees the daily tick can run twice without sending anything twice. In
          production a cron calls the same service on a schedule.
        </p>
      </div>

      <RunJobsButton />
      <SyncSheetsButton />

      {failed > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {failed} job run(s) failed — see the log below.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Dedupe key</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No job runs yet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-2">{formatDate(r.ranAt)}</td>
                <td className="px-3 py-2">{r.jobName}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.dedupeKey}</td>
                <td className="px-3 py-2">
                  <span className={r.status === "SUCCESS" ? "text-emerald-700 dark:text-emerald-400" : r.status === "FAILED" ? "text-red-600" : "text-slate-500"}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

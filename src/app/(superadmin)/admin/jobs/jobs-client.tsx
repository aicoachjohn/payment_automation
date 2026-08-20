"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAutomationAction } from "@/app/(superadmin)/admin/actions";

/** Manually trigger the daily automation tick (a cron calls the same service in prod). */
export function RunJobsButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setMsg(null);
    start(async () => {
      const res = await runAutomationAction({});
      if (res?.data && "ok" in res.data && res.data.ok) {
        const s = res.data.summary;
        setMsg(`Done — ${s.remindersSent} reminder(s), ${s.approachingAlerts} approaching alert(s), ${s.overdueAlerts} overdue alert(s), ${s.staleNudges} nudge(s), ${s.followUpsDue} follow-up(s), ${s.ageingEscalations} ageing escalation(s), ${s.reconciliationExceptions} reconciliation exception(s).`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <button onClick={run} disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {pending ? "Running…" : "Run daily automation now"}
      </button>
      {msg && <p className="text-sm text-emerald-700 dark:text-emerald-400">{msg}</p>}
    </div>
  );
}

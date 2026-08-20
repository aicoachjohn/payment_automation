"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAutomationAction, syncSheetsNowAction } from "@/app/(superadmin)/admin/actions";

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
        setMsg(`Done — ${s.remindersSent} reminder(s), ${s.approachingAlerts} approaching alert(s), ${s.overdueAlerts} overdue alert(s), ${s.staleNudges} nudge(s), ${s.followUpsDue} follow-up(s), ${s.ageingEscalations} ageing escalation(s), ${s.reconciliationExceptions} reconciliation exception(s), ${s.sheetRowsSynced} sheet row(s) synced.`);
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

/**
 * Force a full push to the Google Sheet. Doubles as the setup check: a wrong key or an
 * unshared sheet surfaces here as the actual error, rather than failing quietly overnight.
 */
export function SyncSheetsButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setMsg(null);
    setErr(null);
    start(async () => {
      const res = await syncSheetsNowAction({});
      if (res?.serverError) return setErr(res.serverError);
      if (res?.data && !res.data.ok) return setErr(res.data.error);
      if (res?.data?.ok) {
        setMsg(`Synced ${res.data.written} lead row(s) to the Google Sheet.`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "Syncing…" : "Sync all leads to Google Sheet now"}
      </button>
      {msg && <p className="text-sm text-emerald-700 dark:text-emerald-400">{msg}</p>}
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}

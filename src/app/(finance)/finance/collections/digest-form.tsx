"use client";

import { useState, useTransition } from "react";
import { scheduleFinanceDigestAction } from "@/app/(finance)/finance/actions";

/** Schedule daily / monthly summary emails to oneself (FR-FIN-26). Delivered in Phase 10. */
export function DigestForm({ initial }: { initial: { daily: boolean; monthly: boolean } }) {
  const [daily, setDaily] = useState(initial.daily);
  const [monthly, setMonthly] = useState(initial.monthly);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    setSaved(false);
    start(async () => {
      await scheduleFinanceDigestAction({ daily, monthly });
      setSaved(true);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="text-sm font-semibold">Email me a summary</h3>
      <p className="text-xs text-slate-500">Queued through the notification service; delivery activates in Phase 10.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={daily} onChange={(e) => { setDaily(e.target.checked); setSaved(false); }} />
        Daily approved-collection summary
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={monthly} onChange={(e) => { setMonthly(e.target.checked); setSaved(false); }} />
        Monthly collection summary
      </label>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "Saving…" : "Save schedule"}
      </button>
      {saved && <span className="ml-2 text-xs text-emerald-600">Saved.</span>}
    </div>
  );
}

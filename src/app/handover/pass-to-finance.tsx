"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitToFinanceAction } from "./actions";

/**
 * Nandhiya's onward step. Shown only while the record is still with Data Management; the
 * service re-checks both the role and that every payment has been audited, so this button is
 * a convenience, never the control.
 */
export function PassToFinance({ handoverId, blockers }: { handoverId: string; blockers: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function pass() {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await submitToFinanceAction({ handoverId });
      if (res?.serverError) return setErr(res.serverError);
      if (res?.data && !res.data.ok) return setErr(res.data.error);
      if (res?.data?.ok) setMsg(res.data.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-blue/40 bg-brand-blue-50/50 p-4 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Pass to Finance</h2>
      <p className="text-xs text-slate-500">
        Once every payment on this learner has been audited, hand the record on to Rajesh in Finance.
      </p>

      {msg && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {msg}
        </p>
      )}
      {err && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {err}
        </p>
      )}

      {blockers.length > 0 && !msg && (
        <ul className="list-inside list-disc rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={pass}
        disabled={pending || blockers.length > 0 || !!msg}
        className="inline-flex min-h-[44px] items-center rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50 sm:min-h-0"
      >
        {pending ? "Sending…" : "Hand over to Rajesh (Finance)"}
      </button>
    </div>
  );
}

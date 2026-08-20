"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { financeApproveAction, financeRejectAction } from "./actions";

/**
 * Rajesh's second-level sign-off on a record Nandhiya passed him.
 *
 * Scoped to the handover: nothing here touches a payment's amount, date, Transaction ID or
 * audit status. Rejecting requires a written reason and sends the record back to Data
 * Management, exactly like every other rejection in the platform.
 */
export function FinanceDecision({ handoverId }: { handoverId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "rejecting">("idle");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function approve() {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await financeApproveAction({ handoverId });
      if (res?.serverError) return setErr(res.serverError);
      if (res?.data && !res.data.ok) return setErr(res.data.error);
      if (res?.data?.ok) setMsg(res.data.message);
      router.refresh();
    });
  }

  function reject() {
    setErr(null);
    setMsg(null);
    if (!reason.trim()) {
      return setErr("Say what is wrong with this record so Data Management can fix it.");
    }
    start(async () => {
      const res = await financeRejectAction({ handoverId, reason });
      if (res?.serverError) return setErr(res.serverError);
      if (res?.data && !res.data.ok) return setErr(res.data.error);
      if (res?.data?.ok) {
        setMsg(res.data.message);
        setMode("idle");
        setReason("");
      }
      router.refresh();
    });
  }

  if (msg) {
    return (
      <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        {msg}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand-blue/40 bg-brand-blue-50/50 p-4 dark:border-slate-700 dark:bg-slate-900">
      <div>
        <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Your sign-off</h2>
        <p className="text-xs text-slate-500">
          Data Management has approved every payment on this learner. Approve to sign the record off, or send it back
          with a reason if anything is wrong or missing.
        </p>
      </div>

      {err && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {err}
        </p>
      )}

      {mode === "rejecting" && (
        <div className="space-y-1">
          <label htmlFor="finance-reject-reason" className="text-xs font-semibold text-red-600 dark:text-red-400">
            Reason — required *
          </label>
          <input
            id="finance-reject-reason"
            className="w-full rounded-md border border-red-500 px-2 py-1.5 text-sm outline-none focus:border-red-500 dark:bg-slate-800"
            placeholder="What does Data Management need to correct?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {mode === "idle" ? (
          <>
            <button
              type="button"
              onClick={approve}
              disabled={pending}
              className="inline-flex min-h-[44px] items-center rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50 sm:min-h-0"
            >
              {pending ? "Working…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => setMode("rejecting")}
              disabled={pending}
              className="inline-flex min-h-[44px] items-center rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 sm:min-h-0 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            >
              Send back to Data Management
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={reject}
              disabled={pending}
              className="inline-flex min-h-[44px] items-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 sm:min-h-0"
            >
              {pending ? "Sending…" : "Confirm — send it back"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("idle"); setReason(""); setErr(null); }}
              disabled={pending}
              className="inline-flex min-h-[44px] items-center rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50 sm:min-h-0 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runReconciliationAction, acknowledgeExceptionAction, resolveExceptionAction } from "@/app/(superadmin)/admin/actions";

export function RunReconciliation() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function run() {
    setMsg(null);
    start(async () => {
      const res = await runReconciliationAction({});
      if (res?.data && "ok" in res.data && res.data.ok) setMsg(`Checked ${res.data.checked} enrollment(s); ${res.data.exceptionsRaised} exception(s) raised.`);
      router.refresh();
    });
  }
  return (
    <div className="space-y-2">
      <button onClick={run} disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {pending ? "Running…" : "Run reconciliation now"}
      </button>
      {msg && <p className="text-sm text-emerald-700 dark:text-emerald-400">{msg}</p>}
    </div>
  );
}

interface Ex { id: string; kind: string; detail: string; status: string; resolutionNote: string | null; raisedAt: string }

export function ExceptionActions({ ex }: { ex: Ex }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [showResolve, setShowResolve] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function ack() { start(async () => { await acknowledgeExceptionAction({ id: ex.id }); router.refresh(); }); }
  function resolve() {
    setError(null);
    start(async () => {
      const res = await resolveExceptionAction({ id: ex.id, note });
      if (res?.data && "ok" in res.data && !res.data.ok) return setError(res.data.error);
      if (res?.serverError) return setError(res.serverError);
      setShowResolve(false); setNote("");
      router.refresh();
    });
  }

  if (ex.status === "RESOLVED") return <span className="text-xs text-emerald-600">Resolved{ex.resolutionNote ? `: ${ex.resolutionNote}` : ""}</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {ex.status === "OPEN" && <button onClick={ack} disabled={pending} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">Acknowledge</button>}
        <button onClick={() => setShowResolve((s) => !s)} className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950">Resolve</button>
      </div>
      {showResolve && (
        <div className="flex items-center gap-1">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note" className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800" />
          <button onClick={resolve} disabled={pending || !note.trim()} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50">Save</button>
        </div>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

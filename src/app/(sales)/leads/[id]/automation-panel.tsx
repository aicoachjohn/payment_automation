"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { createFollowUpAction, completeFollowUpAction, performHandoverAction } from "./lead-actions";

interface Task { id: string; description: string; dueDate: string; overdue: boolean }

export function AutomationPanel({
  leadId,
  enrollmentId,
  followUps,
}: {
  leadId: string;
  enrollmentId: string | null;
  followUps: Task[];
}) {
  const router = useRouter();
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [handoverMsg, setHandoverMsg] = useState<string | null>(null);
  const [handoverErr, setHandoverErr] = useState<string | null>(null);
  const [handoverId, setHandoverId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function addTask() {
    setError(null);
    start(async () => {
      const res = await createFollowUpAction({ leadId, dueDate: due, description: desc });
      if (res?.data && "ok" in res.data && !res.data.ok) return setError(res.data.error);
      if (res?.serverError) return setError(res.serverError);
      setDesc(""); setDue("");
      router.refresh();
    });
  }

  function complete(taskId: string) {
    start(async () => { await completeFollowUpAction({ taskId }); router.refresh(); });
  }

  function handover() {
    if (!enrollmentId) return;
    setHandoverErr(null); setHandoverMsg(null);
    start(async () => {
      const res = await performHandoverAction({ enrollmentId });
      if (res?.serverError) return setHandoverErr(res.serverError);
      if (res?.data && "ok" in res.data && !res.data.ok) return setHandoverErr(res.data.error);
      if (res?.data && "ok" in res.data && res.data.ok) {
        setHandoverMsg(res.data.message);
        setHandoverId(res.data.handoverId);
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-lg font-semibold">Follow-up tasks</h2>
        <ul className="mb-3 space-y-1">
          {followUps.length === 0 && <li className="text-sm text-slate-500">No follow-ups.</li>}
          {followUps.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {t.description} <span className={`text-xs ${t.overdue ? "text-red-600" : "text-slate-400"}`}>· due {formatDate(t.dueDate)}</span>
              </span>
              <button onClick={() => complete(t.id)} className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Done</button>
            </li>
          ))}
        </ul>
        {error && <p className="mb-1 text-xs text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Follow-up description" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
          <button onClick={addTask} disabled={pending || !desc.trim() || !due} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">Add</button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-lg font-semibold">Hand over to Data Management</h2>
        <p className="mb-3 text-sm text-slate-500">
          Send the consolidated learner/payment record to Nandhiya for approval. She checks each payment against its
          proof and then passes it on to Rajesh in Finance. You do not need the payments approved or the balance
          cleared first — that is her step.
        </p>
        {handoverMsg && (
          <p className="mb-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {handoverMsg}{handoverId && <> <Link href={`/handover/${handoverId}`} className="underline">View record</Link></>}
          </p>
        )}
        {handoverErr && <p className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{handoverErr}</p>}
        <button onClick={handover} disabled={pending || !enrollmentId} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {pending ? "Sending…" : "Submit handover to Nandhiya"}
        </button>
      </section>
    </div>
  );
}

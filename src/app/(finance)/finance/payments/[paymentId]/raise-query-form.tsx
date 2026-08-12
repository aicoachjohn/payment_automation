"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFinanceQueryAction } from "@/app/(finance)/finance/actions";

/**
 * Raise a Finance Query against an approved payment (FR-FIN-10). This never edits the
 * payment — it opens a separate thread sent to Nandhiya and the salesperson.
 */
export function RaiseQueryForm({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createFinanceQueryAction({ paymentId, subject, message });
      if (res?.serverError) return setError(res.serverError);
      if (res?.data && "error" in res.data && res.data.error) return setError(res.data.error);
      setDone(true);
      setSubject("");
      setMessage("");
      router.refresh();
    });
  }

  if (done) {
    return (
      <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        Query raised. Nandhiya and the salesperson have been notified. The payment record was not changed.{" "}
        <button type="button" className="underline" onClick={() => setDone(false)}>Raise another</button>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="text-sm font-semibold">Raise a Finance Query</h3>
      <p className="text-xs text-slate-500">Sent to Nandhiya and the salesperson. This does not alter the payment.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Your question…"
        rows={3}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
      />
      <button
        type="submit"
        disabled={pending || subject.trim().length < 3 || message.trim().length < 3}
        className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send query"}
      </button>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FinanceQueryThread } from "@/server/services/finance-queries";
import { formatDate } from "@/lib/format";
import { addFinanceQueryCommentAction, resolveFinanceQueryAction } from "@/app/(finance)/finance/actions";

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ANSWERED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  RESOLVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

export function QueriesClient({ threads }: { threads: FinanceQueryThread[] }) {
  if (threads.length === 0) {
    return <p className="text-sm text-slate-500">No Finance Queries yet. Raise one from a payment on the statement.</p>;
  }
  return (
    <div className="space-y-4">
      {threads.map((t) => (
        <Thread key={t.id} thread={t} />
      ))}
    </div>
  );
}

function Thread({ thread }: { thread: FinanceQueryThread }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function comment() {
    setError(null);
    start(async () => {
      const res = await addFinanceQueryCommentAction({ queryId: thread.id, message });
      if (res?.serverError) return setError(res.serverError);
      if (res?.data && "error" in res.data && res.data.error) return setError(res.data.error);
      setMessage("");
      router.refresh();
    });
  }

  function resolve() {
    start(async () => {
      await resolveFinanceQueryAction({ queryId: thread.id });
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{thread.subject}</h3>
          <p className="text-xs text-slate-500">
            {thread.learnerName} · Txn {thread.transactionId} · opened {formatDate(thread.createdAt)}
          </p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[thread.status] ?? ""}`}>{thread.status}</span>
      </div>

      <ol className="my-3 space-y-2">
        {thread.comments.map((c) => (
          <li key={c.id} className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900">
            <div className="text-xs text-slate-500">{c.authorName} ({c.authorRole}) · {formatDate(c.at)}</div>
            <div className="mt-0.5 whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
      </ol>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {thread.status !== "RESOLVED" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a reply…"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={comment}
            disabled={pending || message.trim().length === 0}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Reply
          </button>
          <button
            type="button"
            onClick={resolve}
            disabled={pending}
            className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}

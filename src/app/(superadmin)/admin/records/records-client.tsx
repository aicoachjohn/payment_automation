"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { searchRecordsAction } from "@/app/(superadmin)/admin/actions";

interface Results {
  leads: { id: string; name: string; salesperson: string; status: string }[];
  payments: { id: string; transactionId: string; learner: string; auditStatus: string; delegatedAudit: boolean }[];
}

/** Search any lead or payment, then open its full history (FR-SA-03). Read-only. */
export function RecordsClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [pending, start] = useTransition();

  function search(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await searchRecordsAction({ query });
      if (res?.data && "ok" in res.data && res.data.ok) setResults({ leads: res.data.leads, payments: res.data.payments });
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by learner name, mobile, email or Transaction ID" className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" />
        <button type="submit" disabled={pending} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">{pending ? "Searching…" : "Search"}</button>
      </form>

      {results && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Payments ({results.payments.length})</h3>
            <ul className="space-y-1">
              {results.payments.map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/records/${p.id}`} className="block rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
                    <span className="font-medium">{p.transactionId}</span> · {p.learner}
                    <span className="ml-2 text-xs text-slate-500">{p.auditStatus.replace(/_/g, " ")}</span>
                    {p.delegatedAudit && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] text-violet-800 dark:bg-violet-950 dark:text-violet-300">delegated</span>}
                  </Link>
                </li>
              ))}
              {results.payments.length === 0 && <li className="text-sm text-slate-500">No payments.</li>}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Leads ({results.leads.length})</h3>
            <ul className="space-y-1">
              {results.leads.map((l) => (
                <li key={l.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                  <span className="font-medium">{l.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{l.salesperson} · {l.status.replace(/_/g, " ")}</span>
                </li>
              ))}
              {results.leads.length === 0 && <li className="text-sm text-slate-500">No leads.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

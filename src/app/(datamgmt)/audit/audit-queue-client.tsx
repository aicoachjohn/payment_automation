"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatINR, formatDate } from "@/lib/format";
import { bulkApproveAction } from "./actions";

export interface QueueRow {
  id: string; leadName: string; mobile: string | null; ownerName: string;
  program: string; plan: string; paymentNumber: number; paymentType: string;
  expectedAmount: string; receivedAmount: string; paymentDate: string; paymentMethod: string;
  transactionId: string; auditStatus: string; manualEntryNoOcr: boolean; hasVariance: boolean;
  delegatedAudit: boolean;
}

export function AuditQueueClient({ rows }: { rows: QueueRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = rows.filter((r) => r.auditStatus === "PENDING_AUDIT" || r.auditStatus === "RESUBMITTED");
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function bulk() {
    if (selected.size === 0) return;
    setBanner(null);
    start(async () => {
      const res = await bulkApproveAction({ paymentIds: [...selected] });
      if (res?.serverError) return setBanner(res.serverError);
      if (res?.data) {
        setBanner(`Approved ${res.data.approved.length}. Skipped ${res.data.skipped.length}${res.data.skipped.length ? ": " + res.data.skipped.map((s) => s.reason).join("; ") : ""}.`);
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {banner && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{banner}</p>}
      <div className="flex items-center gap-3">
        <button onClick={bulk} disabled={pending || selected.size === 0} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          Bulk approve clean ({selected.size})
        </button>
        <span className="text-xs text-slate-500">Bulk approve applies every blocking rule per record and reports what it skipped.</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Lead</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Expected</th><th className="px-3 py-2">Received</th><th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Txn ID</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Nothing in the queue.</td></tr>}
            {rows.map((r) => {
              const flagged = r.manualEntryNoOcr || r.hasVariance;
              return (
                <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 ${flagged ? "bg-amber-50/60 dark:bg-amber-950/30" : ""}`}>
                  <td className="px-3 py-2">{open.some((o) => o.id === r.id) && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                  <td className="px-3 py-2"><Link href={`/audit/${r.id}`} className="font-medium hover:underline">{r.leadName}</Link><div className="text-xs text-slate-500">#{r.paymentNumber} · {r.program}/{r.plan}</div></td>
                  <td className="px-3 py-2 text-slate-500">{r.ownerName}</td>
                  <td className="px-3 py-2">{r.paymentType}{r.manualEntryNoOcr && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">Manual·NoOCR</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatINR(r.expectedAmount)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatINR(r.receivedAmount)}{r.hasVariance && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">variance</span>}</td>
                  <td className="px-3 py-2 text-xs">{formatDate(r.paymentDate)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.transactionId}</td>
                  <td className="px-3 py-2 text-xs">{r.auditStatus}{r.delegatedAudit && <span className="ml-1 rounded bg-violet-100 px-1 text-violet-800 dark:bg-violet-950 dark:text-violet-300">delegated</span>}</td>
                  <td className="px-3 py-2"><Link href={`/audit/${r.id}`} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Audit</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

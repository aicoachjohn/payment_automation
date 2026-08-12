"use client";

import { useEffect, useState, useTransition } from "react";
import type { CustomerRow, HistoryPayment } from "@/server/services/finance";
import { CUSTOMER_COLUMNS } from "@/lib/finance-columns";
import { formatINR, formatDate } from "@/lib/format";
import { customerHistoryAction } from "@/app/(finance)/finance/actions";
import { ProofViewer } from "@/components/shared/proof-viewer";

const STORAGE_KEY = "finance.customer.columns";

/**
 * Customer master table with configurable/saveable column selection (FR-FIN-18) and
 * per-row expandable payment history (FR-FIN-16). Column order always follows
 * CUSTOMER_COLUMNS — the same order the CSV export uses (FR-FIN-15).
 */
export function CustomerMasterClient({ rows }: { rows: CustomerRow[] }) {
  const allHeaders = CUSTOMER_COLUMNS.map((c) => c.header);
  const [visible, setVisible] = useState<Set<string>>(new Set(allHeaders));
  const [showPicker, setShowPicker] = useState(false);

  // Load saved column selection (FR-FIN-18 "saveable").
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved) as string[];
        setVisible(new Set(arr.filter((h) => allHeaders.includes(h))));
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(header: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(header)) next.delete(header);
      else next.add(header);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const cols = CUSTOMER_COLUMNS.filter((c) => visible.has(c.header));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowPicker((s) => !s)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Columns ({cols.length}/{allHeaders.length})
        </button>
        <span className="text-sm text-slate-500">{rows.length} customer{rows.length === 1 ? "" : "s"}</span>
      </div>

      {showPicker && (
        <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
          {allHeaders.map((h) => (
            <label key={h} className="flex items-center gap-1.5">
              <input type="checkbox" checked={visible.has(h)} onChange={() => toggle(h)} />
              {h}
            </label>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2" />
              {cols.map((c) => <th key={c.header} className="whitespace-nowrap px-3 py-2">{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="px-3 py-6 text-center text-slate-500">No customers match this selection.</td></tr>
            )}
            {rows.map((r) => (
              <CustomerRowView key={r.enrollmentId} row={r} cols={cols} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerRowView({ row, cols }: { row: CustomerRow; cols: typeof CUSTOMER_COLUMNS }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryPayment[] | null>(null);
  const [approvedTotal, setApprovedTotal] = useState<string>("0.00");
  const [pending, start] = useTransition();

  function expand() {
    setOpen((o) => !o);
    if (history === null) {
      start(async () => {
        const res = await customerHistoryAction({ enrollmentId: row.enrollmentId });
        if (res?.data && "ok" in res.data) {
          setHistory(res.data.payments);
          setApprovedTotal(res.data.approvedTotal);
        }
      });
    }
  }

  return (
    <>
      <tr className="border-t border-slate-100 dark:border-slate-800">
        <td className="px-3 py-2">
          <button type="button" onClick={expand} aria-expanded={open} className="text-sky-600 hover:underline">
            {open ? "▾" : "▸"}
          </button>
        </td>
        {cols.map((c) => (
          <td key={c.header} className="whitespace-nowrap px-3 py-2">
            {c.header === "Customer Name" ? (
              <span className="flex items-center gap-1">
                {c.get(row)}
                {row.incomplete.length > 0 && (
                  <span
                    className="rounded bg-red-100 px-1 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300"
                    title={`Missing: ${row.incomplete.join(", ")}`}
                  >
                    incomplete
                  </span>
                )}
                {row.specialMarker && (
                  <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">{row.specialMarker}</span>
                )}
              </span>
            ) : (
              c.get(row)
            )}
          </td>
        ))}
      </tr>
      {open && (
        <tr className="bg-slate-50 dark:bg-slate-900/50">
          <td colSpan={cols.length + 1} className="px-6 py-3">
            {pending && <p className="text-sm text-slate-500">Loading payment history…</p>}
            {history && history.length === 0 && <p className="text-sm text-slate-500">No payments recorded.</p>}
            {history && history.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">
                  Approved total counted in Finance: <strong>{formatINR(approvedTotal)}</strong>. Non-approved rows
                  are shown for transparency and never counted.
                </p>
                <table className="min-w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-4">#</th>
                      <th className="py-1 pr-4">Type</th>
                      <th className="py-1 pr-4">Amount</th>
                      <th className="py-1 pr-4">Date</th>
                      <th className="py-1 pr-4">Txn ID</th>
                      <th className="py-1 pr-4">Outcome</th>
                      <th className="py-1 pr-4">Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p) => (
                      <tr key={p.id} className={p.countedInTotals ? "" : "text-slate-400"}>
                        <td className="py-1 pr-4">{p.paymentNumber}</td>
                        <td className="py-1 pr-4">{p.paymentType}</td>
                        <td className="py-1 pr-4">{formatINR(p.receivedAmount)}</td>
                        <td className="py-1 pr-4">{formatDate(p.paymentDate)}</td>
                        <td className="py-1 pr-4">{p.transactionId}</td>
                        <td className="py-1 pr-4">
                          <span className={p.countedInTotals ? "text-emerald-700 dark:text-emerald-400" : ""}>
                            {p.auditStatus.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="py-1 pr-4">{p.proofId ? <ProofViewer proofId={p.proofId} label="Proof" /> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

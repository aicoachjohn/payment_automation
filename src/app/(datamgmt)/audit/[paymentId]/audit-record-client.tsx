"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatINR, formatDate } from "@/lib/format";
import { ProofViewer } from "@/components/shared/proof-viewer";
import { approvePaymentAction, requestCorrectionAction, rejectPaymentAction } from "../actions";

interface Record {
  id: string; leadName: string; mobile: string | null; email: string | null; ownerName: string;
  program: string; plan: string; paymentNumber: number; paymentType: string;
  expectedAmount: string; receivedAmount: string; paymentDate: string; paymentMethod: string;
  transactionId: string; auditStatus: string; auditComment: string | null; manualEntryNoOcr: boolean;
  varianceReason: string | null; hasVariance: boolean; finalApprovedFee: string | null;
  totalReceivedToDate: string; balance: string; wouldExceedFee: boolean; probableDuplicate: boolean;
  proofId: string | null; proofVersions: number;
}
interface TimelineEntry { id: string; action: string; field: string | null; oldValue: string | null; newValue: string | null; byName: string; role: string; at: string; }

const box = "rounded-lg border border-slate-200 p-5 dark:border-slate-800";
const input = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800";

export function AuditRecordClient({ record, timeline, reasonCodes }: { record: Record; timeline: TimelineEntry[]; reasonCodes: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [banner, setBanner] = useState<string | null>(null);
  const [conf, setConf] = useState({ amountMatches: false, dateMatches: false, transactionIdMatches: false });
  const [varianceReason, setVarianceReason] = useState("");
  const [reasonCode, setReasonCode] = useState(reasonCodes[0] ?? "");
  const [comment, setComment] = useState("");

  const open = record.auditStatus === "PENDING_AUDIT" || record.auditStatus === "RESUBMITTED";
  const allConfirmed = conf.amountMatches && conf.dateMatches && conf.transactionIdMatches;
  const canApprove = open && allConfirmed && record.proofId && !record.wouldExceedFee && (!record.hasVariance || varianceReason.trim().length > 0);

  function run(fn: () => Promise<{ serverError?: string } | undefined>) {
    setBanner(null);
    start(async () => {
      const res = await fn();
      if (res?.serverError) return setBanner(res.serverError);
      router.push("/audit");
      router.refresh();
    });
  }
  const approve = () => canApprove && run(() => approvePaymentAction({ paymentId: record.id, confirmations: conf, varianceReason: varianceReason || undefined }));
  const correction = () => open && comment.trim() && run(() => requestCorrectionAction({ paymentId: record.id, reasonCode, comment }));
  const reject = () => open && comment.trim() && run(() => rejectPaymentAction({ paymentId: record.id, reasonCode, comment }));

  // Keyboard shortcuts (Nandhiya is the bottleneck — every second matters).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.toLowerCase() === "a") approve();
      if (e.key.toLowerCase() === "c") correction();
      if (e.key.toLowerCase() === "r") reject();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conf, varianceReason, reasonCode, comment, record]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{record.leadName} · Payment #{record.paymentNumber}</h1>
          <p className="text-sm text-slate-500">{record.program}/{record.plan} · owner {record.ownerName} · status {record.auditStatus}</p>
        </div>
        <a href={`/api/audit/${record.id}/timeline`} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Timeline PDF</a>
      </div>

      {banner && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{banner}</p>}

      {/* Split view: proof left, entered values right (FR-DM-03). */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={box}>
          <h2 className="mb-3 text-sm font-medium">Proof {record.proofVersions > 1 && <span className="text-xs text-slate-500">(v{record.proofVersions})</span>}</h2>
          {record.proofId ? <ProofViewer proofId={record.proofId} label="Load proof" /> : <p className="text-sm text-red-600">No proof uploaded — approval is blocked.</p>}
        </div>

        <div className={`${box} space-y-3`}>
          <h2 className="text-sm font-medium">Entered values</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">Expected</dt><dd className="font-mono">{formatINR(record.expectedAmount)}</dd>
            <dt className="text-slate-500">Received</dt><dd className="font-mono">{formatINR(record.receivedAmount)}{record.hasVariance && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">variance</span>}</dd>
            <dt className="text-slate-500">Date</dt><dd>{formatDate(record.paymentDate)}</dd>
            <dt className="text-slate-500">Method</dt><dd>{record.paymentMethod}</dd>
            <dt className="text-slate-500">Txn ID</dt><dd className="font-mono">{record.transactionId || <span className="text-red-600">blank</span>}</dd>
            <dt className="text-slate-500">Total received</dt><dd className="font-mono">{formatINR(record.totalReceivedToDate)}</dd>
            <dt className="text-slate-500">Balance</dt><dd className="font-mono">{formatINR(record.balance)}</dd>
          </dl>
          {record.manualEntryNoOcr && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Manual entry — no OCR. Verify carefully.</p>}
          {record.probableDuplicate && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Probable duplicate — same lead, amount and date within the window.</p>}
          {record.wouldExceedFee && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">This would exceed the Final Approved Fee — over-collection needs a Super Admin override.</p>}
        </div>
      </div>

      {open && (
        <div className={`${box} space-y-4`}>
          <h2 className="text-sm font-medium">Decision</h2>
          <div className="space-y-1">
            <p className="text-xs text-slate-500">Confirm each value matches the proof (all three required to approve — BR-27):</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={conf.amountMatches} onChange={(e) => setConf({ ...conf, amountMatches: e.target.checked })} /> Received amount matches the proof</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={conf.dateMatches} onChange={(e) => setConf({ ...conf, dateMatches: e.target.checked })} /> Payment date matches the proof</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={conf.transactionIdMatches} onChange={(e) => setConf({ ...conf, transactionIdMatches: e.target.checked })} /> Transaction ID matches the proof</label>
          </div>
          {record.hasVariance && (
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Accept the amount difference with a reason (required to approve)</label>
              <input className={input} value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} />
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <label className="flex flex-col gap-1 text-xs text-slate-500">Reason code
              <select className={input} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                {reasonCodes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">Comment (required for correction/rejection)
              <input className={input} value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={approve} disabled={pending || !canApprove} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" title="A">Approve (A)</button>
            <button onClick={correction} disabled={pending || !comment.trim()} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50" title="C">Correction (C)</button>
            <button onClick={reject} disabled={pending || !comment.trim()} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50" title="R">Reject (R)</button>
          </div>
        </div>
      )}

      <div className={box}>
        <h2 className="mb-3 text-sm font-medium">Audit history (immutable)</h2>
        <ol className="space-y-2 text-sm">
          {timeline.map((e) => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
              <div className="text-xs text-slate-500">{formatDate(e.at)} · {e.byName} ({e.role})</div>
              <div>
                <span className="font-medium">{e.action}</span>
                {e.field && <span className="text-slate-500"> · {e.field}: {e.oldValue ?? "∅"} → {e.newValue ?? "∅"}</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

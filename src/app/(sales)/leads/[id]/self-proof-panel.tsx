"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { confirmSelfProofAction } from "@/app/(sales)/leads/payment-actions";
import type { HeldProof } from "@/server/services/lead-intake-link";

const input =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const labelCls = "text-xs font-medium text-slate-600 dark:text-slate-300";

function toDateInput(iso?: string) { return iso ? iso.slice(0, 10) : ""; }
function fromDateInput(v: string) { return v ? new Date(`${v}T00:00:00.000Z`).toISOString() : ""; }

/**
 * The learner uploaded these payment proofs on the self-intake form. The salesperson VERIFIES
 * each against the screenshot (BR-20) and confirms it into a real payment → PENDING_AUDIT.
 * Confirming needs the fee to be KNOWN, not locked — a self-filled lead is already priced
 * from the course it chose on the intake form, so this is usually a one-click confirmation.
 * Learners normally book with an advance, so a part payment needs no explanation here.
 */
export function SelfProofPanel({ leadId, proofs, feeKnown }: { leadId: string; proofs: HeldProof[]; feeKnown: boolean }) {
  return (
    <div className="space-y-4 rounded-lg border border-brand-blue/40 bg-brand-blue-50/50 p-5 dark:border-slate-700 dark:bg-slate-900">
      <div>
        <h2 className="text-lg font-semibold text-brand-navy dark:text-slate-100">Learner-submitted payment proof{proofs.length > 1 ? "s" : ""}</h2>
        <p className="text-xs text-slate-500">
          The lead uploaded {proofs.length} proof{proofs.length > 1 ? "s" : ""} on the intake form. Check each against the
          screenshot and confirm. A booking advance is normal — just record what they actually paid.
        </p>
      </div>
      {!feeKnown && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Select the course above first — then you can confirm this payment.
        </p>
      )}
      {proofs.map((p) => (
        <ProofCard key={p.id} leadId={leadId} proof={p} feeKnown={feeKnown} />
      ))}
    </div>
  );
}

function ProofCard({ leadId, proof, feeKnown }: { leadId: string; proof: HeldProof; feeKnown: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isPdf = proof.fileType.includes("pdf");
  const [f, setF] = useState({
    receivedAmount: proof.ocr.receivedAmount ?? "",
    paymentDate: proof.ocr.paymentDate ?? "",
    transactionId: proof.ocr.transactionId ?? "",
    paymentMethod: (proof.ocr.paymentMethod as PaymentMethod) ?? PaymentMethod.UPI,
    varianceReason: "",
  });
  const [conf, setConf] = useState({ receivedAmount: false, paymentDate: false, transactionId: false, paymentMethod: false });

  const need = (k: keyof typeof conf) => proof.ocr[k as keyof typeof proof.ocr] != null;
  const ready =
    feeKnown && f.receivedAmount && f.paymentDate && f.transactionId && f.paymentMethod &&
    (["receivedAmount", "paymentDate", "transactionId", "paymentMethod"] as const).every((k) => !need(k) || conf[k]);

  function confirm() {
    setError(null);
    start(async () => {
      const res = await confirmSelfProofAction({
        leadId, selfProofId: proof.id,
        receivedAmount: f.receivedAmount, paymentDate: f.paymentDate, paymentMethod: f.paymentMethod,
        transactionId: f.transactionId, confirmations: conf, varianceReason: f.varianceReason || undefined,
      });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please check the fields and tick each confirmed value.");
      if (res?.data?.ok) router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[140px_1fr] dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-1">
        {isPdf ? (
          <a href={`/api/self-proofs/${proof.id}`} target="_blank" rel="noreferrer" className="flex h-28 w-full items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-brand-blue underline dark:border-slate-700 dark:bg-slate-900">
            Open PDF
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/self-proofs/${proof.id}`} alt="Learner payment proof" className="max-h-40 w-full rounded-md border border-slate-200 object-contain dark:border-slate-700" />
        )}
        <span className="max-w-full truncate text-[11px] text-slate-400" title={proof.originalFilename ?? undefined}>{proof.originalFilename ?? "proof"}</span>
      </div>
      <div className="space-y-2">
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ConfirmField l="Amount received" ocr={need("receivedAmount")} checked={conf.receivedAmount} onCheck={(v) => setConf({ ...conf, receivedAmount: v })}>
            <input className={input} value={f.receivedAmount} onChange={(e) => setF({ ...f, receivedAmount: e.target.value })} />
          </ConfirmField>
          <ConfirmField l="Transaction ID" ocr={need("transactionId")} checked={conf.transactionId} onCheck={(v) => setConf({ ...conf, transactionId: v })}>
            <input className={input} value={f.transactionId} onChange={(e) => setF({ ...f, transactionId: e.target.value })} />
          </ConfirmField>
          <ConfirmField l="Payment date" ocr={need("paymentDate")} checked={conf.paymentDate} onCheck={(v) => setConf({ ...conf, paymentDate: v })}>
            <input type="date" className={input} value={toDateInput(f.paymentDate)} onChange={(e) => setF({ ...f, paymentDate: fromDateInput(e.target.value) })} />
          </ConfirmField>
          <ConfirmField l="Method" ocr={need("paymentMethod")} checked={conf.paymentMethod} onCheck={(v) => setConf({ ...conf, paymentMethod: v })}>
            <select className={input} value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value as PaymentMethod })}>
              {Object.values(PaymentMethod).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </ConfirmField>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Note (optional)</label>
          <input className={input} value={f.varianceReason} onChange={(e) => setF({ ...f, varianceReason: e.target.value })} />
        </div>
        <button
          type="button"
          onClick={confirm}
          disabled={pending || !ready}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-700 disabled:opacity-50"
        >
          {pending ? "Recording…" : "Confirm & record payment"}
        </button>
      </div>
    </div>
  );
}

function ConfirmField({ l, ocr, checked, onCheck, children }: { l: string; ocr: boolean; checked: boolean; onCheck: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className={labelCls}>{l}</label>
        {ocr && (
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} /> confirm
          </label>
        )}
      </div>
      {children}
    </div>
  );
}

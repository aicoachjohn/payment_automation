"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { formatINR, formatDate } from "@/lib/format";
import { ProofViewer } from "@/components/shared/proof-viewer";
import { uploadProofAction, capturePaymentAction } from "@/app/(sales)/leads/payment-actions";

type OcrField = "receivedAmount" | "paymentDate" | "transactionId" | "paymentMethod";

export interface PaymentRow {
  id: string; paymentNumber: number; paymentType: string; expectedAmount: string;
  receivedAmount: string; paymentDate: string; paymentMethod: string; transactionId: string;
  auditStatus: string; manualEntryNoOcr: boolean; varianceReason: string | null;
  proofId: string | null; proofVersions: number; delegatedAudit: boolean;
}

interface StagedProof {
  key: string; checksum: string; fileType: string; fileSize: number; originalFilename: string;
  ocr: { ok: boolean; fields: Record<string, string>; confidence: Record<string, number> };
}

const input = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

export function PaymentPanel({
  leadId, payments, balance, finalApprovedFee,
}: { leadId: string; payments: PaymentRow[]; balance: string; finalApprovedFee: string | null }) {
  const router = useRouter();
  return (
    <div className="space-y-5 rounded-lg border border-slate-200 p-5 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payments</h2>
        <div className="text-sm text-slate-500">
          Fee {finalApprovedFee ? formatINR(finalApprovedFee) : "—"} · Balance <span className="font-medium">{formatINR(balance)}</span>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Received</th><th className="px-3 py-2">Txn ID</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Audit</th><th className="px-3 py-2">Proof</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{p.paymentNumber}</td>
                  <td className="px-3 py-2">{p.paymentType}{p.manualEntryNoOcr && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">Manual · No OCR</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatINR(p.receivedAmount)}{p.varianceReason && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800" title={p.varianceReason}>variance</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.transactionId}</td>
                  <td className="px-3 py-2 text-xs">{formatDate(p.paymentDate)}</td>
                  <td className="px-3 py-2 text-xs">{p.auditStatus}{p.delegatedAudit && <span className="ml-1 rounded bg-violet-100 px-1 text-violet-800 dark:bg-violet-950 dark:text-violet-300" title="Audited by Super Admin (delegated)">delegated</span>}</td>
                  <td className="px-3 py-2">{p.proofId ? <ProofViewer proofId={p.proofId} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CaptureForm leadId={leadId} onDone={() => router.refresh()} />
    </div>
  );
}

function CaptureForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [proof, setProof] = useState<StagedProof | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [values, setValues] = useState<Record<OcrField, string>>({ receivedAmount: "", paymentDate: "", transactionId: "", paymentMethod: PaymentMethod.UPI });
  const [confirmed, setConfirmed] = useState<Record<OcrField, boolean>>({ receivedAmount: false, paymentDate: false, transactionId: false, paymentMethod: false });
  const [varianceReason, setVarianceReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();

  const ocrExtracted = proof?.ocr.fields ?? {};
  const confidence = proof?.ocr.confidence ?? {};

  async function onFile(file: File) {
    setError(null);
    setUploading(true);
    setPreviewUrl(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    const fd = new FormData();
    fd.append("leadId", leadId);
    fd.append("file", file);
    const res = await uploadProofAction(fd);
    setUploading(false);
    if ("error" in res && res.error) return setError(res.error);
    if ("ok" in res && res.ok) {
      const p = res.proof as StagedProof;
      setProof(p);
      const f = p.ocr.fields;
      setValues({
        receivedAmount: f.receivedAmount ?? "",
        paymentDate: f.paymentDate ? f.paymentDate.slice(0, 10) : "",
        transactionId: f.transactionId ?? "",
        paymentMethod: (f.paymentMethod as PaymentMethod) ?? PaymentMethod.UPI,
      });
      // Pre-mark manual (non-OCR) fields as confirmed; OCR fields must be confirmed by hand.
      setConfirmed({
        receivedAmount: f.receivedAmount == null,
        paymentDate: f.paymentDate == null,
        transactionId: f.transactionId == null,
        paymentMethod: f.paymentMethod == null,
      });
    }
  }

  function submit() {
    if (!proof) return;
    setError(null);
    start(async () => {
      const res = await capturePaymentAction({
        leadId,
        proof: { key: proof.key, checksum: proof.checksum, fileType: proof.fileType, fileSize: proof.fileSize, originalFilename: proof.originalFilename },
        receivedAmount: values.receivedAmount,
        paymentDate: values.paymentDate ? new Date(values.paymentDate).toISOString() : "",
        paymentMethod: values.paymentMethod as PaymentMethod,
        transactionId: values.transactionId,
        confirmations: confirmed,
        varianceReason: varianceReason || undefined,
        manualEntryNoOcr: !proof.ocr.ok,
      });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please check the fields — proof, amount, date and Transaction ID are required.");
      if (res?.data?.ok) {
        setProof(null); setPreviewUrl(null); setVarianceReason("");
        if (fileRef.current) fileRef.current.value = "";
        onDone();
      }
    });
  }

  return (
    <div className="space-y-4 rounded-md border border-dashed border-slate-300 p-4 dark:border-slate-700">
      <div className="text-sm font-medium">Record a payment</div>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <div
        className="flex min-h-24 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      >
        {uploading ? "Uploading & reading…" : proof ? `Uploaded: ${proof.originalFilename}` : "Drop the payment screenshot here, or click to choose (JPG/PNG/PDF, max 10 MB)"}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>

      {proof && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Uploaded proof" className="max-h-72 rounded border border-slate-200 dark:border-slate-800" />
            ) : (
              <div className="rounded border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">PDF uploaded — {proof.originalFilename}</div>
            )}
            {!proof.ocr.ok && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">OCR could not read this file — enter the details manually (flagged “Manual · No OCR”).</p>}
          </div>
          <div className="space-y-3">
            <Field label="Received amount" field="receivedAmount" values={values} setValues={setValues} confirmed={confirmed} setConfirmed={setConfirmed} extracted={ocrExtracted} confidence={confidence} />
            <Field label="Payment date (on proof)" field="paymentDate" type="date" values={values} setValues={setValues} confirmed={confirmed} setConfirmed={setConfirmed} extracted={ocrExtracted} confidence={confidence} />
            <Field label="Transaction ID (UTR)" field="transactionId" values={values} setValues={setValues} confirmed={confirmed} setConfirmed={setConfirmed} extracted={ocrExtracted} confidence={confidence} />
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Payment method</label>
              <div className="flex items-center gap-2">
                <select className={input} value={values.paymentMethod} onChange={(e) => setValues({ ...values, paymentMethod: e.target.value })}>
                  {Object.values(PaymentMethod).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <ConfirmBox field="paymentMethod" confirmed={confirmed} setConfirmed={setConfirmed} extracted={ocrExtracted} confidence={confidence} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Reason (only if amount differs from expected)</label>
              <input className={input} value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} />
            </div>
            <button className={btn} disabled={pending} onClick={submit}>{pending ? "Submitting…" : "Submit to audit"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, field, type = "text", values, setValues, confirmed, setConfirmed, extracted, confidence }: {
  label: string; field: OcrField; type?: string;
  values: Record<OcrField, string>; setValues: (v: Record<OcrField, string>) => void;
  confirmed: Record<OcrField, boolean>; setConfirmed: (v: Record<OcrField, boolean>) => void;
  extracted: Record<string, string>; confidence: Record<string, number>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-500">{label}</label>
      <div className="flex items-center gap-2">
        <input type={type} className={input} value={values[field]} onChange={(e) => { setValues({ ...values, [field]: e.target.value }); setConfirmed({ ...confirmed, [field]: false }); }} />
        <ConfirmBox field={field} confirmed={confirmed} setConfirmed={setConfirmed} extracted={extracted} confidence={confidence} />
      </div>
    </div>
  );
}

function ConfirmBox({ field, confirmed, setConfirmed, extracted, confidence }: {
  field: OcrField; confirmed: Record<OcrField, boolean>; setConfirmed: (v: Record<OcrField, boolean>) => void;
  extracted: Record<string, string>; confidence: Record<string, number>;
}) {
  const wasOcr = extracted[field] != null;
  const conf = confidence[field];
  const low = wasOcr && conf != null && conf < 0.6;
  return (
    <label className="flex items-center gap-1 whitespace-nowrap text-xs">
      <input type="checkbox" checked={confirmed[field]} onChange={(e) => setConfirmed({ ...confirmed, [field]: e.target.checked })} />
      {wasOcr ? (low ? <span className="text-red-600">confirm (low)</span> : <span className="text-emerald-600">confirm</span>) : <span className="text-slate-400">confirm</span>}
    </label>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ComboMode, PaymentMethod, Plan, Program } from "@prisma/client";
import { formatINR } from "@/lib/format";

// ── Shared view-types (the intake service is server-only; mirror its preview shape) ──
export type OcrField = "receivedAmount" | "paymentDate" | "transactionId" | "paymentMethod";

export interface StagedProof {
  key: string; checksum: string; fileType: string; fileSize: number; originalFilename: string;
  ocr: { ok: boolean; fields: Record<string, string>; confidence: Record<string, number> };
}
export interface PreviewPayment {
  proof: StagedProof;
  receivedAmount?: string; paymentDate?: string; transactionId?: string;
  paymentMethod?: PaymentMethod; payerName?: string;
}
export interface BundlePreview {
  learner: {
    fullName?: string; dob?: string; doorNo: string; street: string; address: string;
    district: string; state: string; pincode?: string; email?: string; mobile?: string;
  };
  course: {
    program?: Program; plan?: Plan; comboMode?: ComboMode | null; programName?: string;
    commencingDate?: string; textCourseFee?: string; systemFee?: string; feeMismatch: boolean;
  };
  payments: PreviewPayment[];
  warnings: string[];
}

/** The reviewed + confirmed bundle the parent posts (to commit OR apply). */
export interface ReviewedBundleValue {
  learner: {
    fullName: string; dob: string; doorNo: string; street: string; address: string;
    district: string; state: string; pincode: string; email: string; mobile: string;
    leadSource?: string; remarks?: string;
  };
  course: { program: Program; plan: Plan; comboMode?: ComboMode | null; commencingDate?: string | null };
  payments: {
    proof: { key: string; checksum: string; fileType: string; fileSize: number; originalFilename: string };
    receivedAmount: string; paymentDate: string; paymentMethod: PaymentMethod; transactionId: string;
    confirmations: Record<OcrField, boolean>; varianceReason?: string; manualEntryNoOcr: boolean;
  }[];
}

interface PaymentDraft {
  proof: StagedProof; previewUrl: string | null; isPdf: boolean;
  receivedAmount: string; paymentDate: string; transactionId: string; paymentMethod: PaymentMethod;
  payerName: string; confirmations: Record<OcrField, boolean>; varianceReason: string;
}

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const labelCls = "text-xs font-medium text-slate-600 dark:text-slate-300";
const navyBtn =
  "rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50";

const PROGRAMS: { value: Program; label: string }[] = [
  { value: Program.DATA_ANALYST, label: "Data Analyst" },
  { value: Program.ADV_DATA_SCIENCE_AI, label: "Advanced Data Science & AI" },
  { value: Program.AGENTIC_AI_GENAI, label: "Agentic AI & Gen AI" },
  { value: Program.COMBO_ALL_THREE, label: "Combo — All Three" },
];

export function toDateInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}
function fromDateInput(value: string): string {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : "";
}
/** Exact sum of 2-dp money strings → "x.xx" (guidance only; no float / Number(<money>), FR-REC-07). */
function sumMoney(values: string[]): string {
  let totalMinor = 0;
  for (const v of values) {
    const [whole, frac = ""] = (v || "0").replace(/[^\d.]/g, "").split(".");
    totalMinor += (whole === "" ? 0 : parseInt(whole, 10)) * 100 + parseInt(`${frac}00`.slice(0, 2), 10);
  }
  return `${Math.floor(totalMinor / 100)}.${String(totalMinor % 100).padStart(2, "0")}`;
}

/**
 * The pre-filled, editable review of an extracted enrollment bundle — learner details,
 * program/fee (with the text-vs-Pricing-Master cross-check) and one payment card per proof
 * with BR-20 per-field confirmation. Used by BOTH the "Enrollment from uploads" page (creates
 * a lead) and the lead page's "Auto-fill from uploads" panel (fills an existing lead).
 */
export function EnrollmentBundleForm({
  preview, files, submitLabel, submitting, onSubmit, onBack,
}: {
  preview: BundlePreview;
  files: File[];
  submitLabel: string;
  submitting: boolean;
  onSubmit: (bundle: ReviewedBundleValue) => void;
  onBack?: () => void;
}) {
  const [learner, setLearner] = useState({
    fullName: preview.learner.fullName ?? "", dob: toDateInput(preview.learner.dob),
    doorNo: preview.learner.doorNo, street: preview.learner.street, address: preview.learner.address,
    district: preview.learner.district, state: preview.learner.state, pincode: preview.learner.pincode ?? "",
    email: preview.learner.email ?? "", mobile: preview.learner.mobile ?? "",
    leadSource: "Enrollment intake", remarks: "",
  });
  const [course, setCourse] = useState<{
    program: Program | ""; plan: Plan | ""; comboMode: ComboMode | ""; commencingDate: string;
  }>({
    program: preview.course.program ?? "", plan: preview.course.plan ?? "",
    comboMode: preview.course.comboMode ?? "", commencingDate: toDateInput(preview.course.commencingDate),
  });
  const multi = preview.payments.length > 1;
  const [payments, setPayments] = useState<PaymentDraft[]>(() =>
    preview.payments.map((p, i) => {
      const file = files[i];
      const isPdf = p.proof.fileType.includes("pdf");
      return {
        proof: p.proof,
        previewUrl: file && !isPdf ? URL.createObjectURL(file) : null,
        isPdf,
        receivedAmount: p.receivedAmount ?? "",
        paymentDate: p.paymentDate ?? "",
        transactionId: p.transactionId ?? "",
        paymentMethod: p.paymentMethod ?? PaymentMethod.UPI,
        payerName: p.payerName ?? "",
        confirmations: { receivedAmount: false, paymentDate: false, transactionId: false, paymentMethod: false },
        varianceReason: multi ? "Part payment via enrollment intake" : "",
      };
    }),
  );

  function setPay(i: number, patch: Partial<PaymentDraft>) {
    setPayments((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function setConfirm(i: number, field: OcrField, value: boolean) {
    setPayments((ps) => ps.map((p, idx) => (idx === i ? { ...p, confirmations: { ...p.confirmations, [field]: value } } : p)));
  }

  const paymentsReady = payments.every((p) => {
    const f = p.proof.ocr.fields;
    const need: OcrField[] = ["receivedAmount", "paymentDate", "transactionId", "paymentMethod"];
    return (
      p.receivedAmount && p.paymentDate && p.transactionId && p.paymentMethod &&
      need.every((k) => f[k] == null || p.confirmations[k])
    );
  });
  const learnerReady =
    learner.fullName && learner.dob && learner.doorNo && learner.street && learner.address &&
    learner.district && learner.state && /^\d{6}$/.test(learner.pincode) && learner.email && learner.mobile;
  const courseReady = course.program && course.plan && (course.program !== Program.COMBO_ALL_THREE || course.comboMode);
  const canConfirm = Boolean(learnerReady && courseReady && payments.length > 0 && paymentsReady);
  const receivedTotal = useMemo(() => sumMoney(payments.map((p) => p.receivedAmount)), [payments]);

  function submit() {
    onSubmit({
      learner: {
        fullName: learner.fullName, dob: learner.dob, doorNo: learner.doorNo, street: learner.street,
        address: learner.address, district: learner.district, state: learner.state, pincode: learner.pincode,
        email: learner.email, mobile: learner.mobile, leadSource: learner.leadSource || undefined,
        remarks: learner.remarks || undefined,
      },
      course: {
        program: course.program as Program,
        plan: course.plan as Plan,
        comboMode: course.comboMode ? (course.comboMode as ComboMode) : null,
        commencingDate: course.commencingDate ? fromDateInput(course.commencingDate) : null,
      },
      payments: payments.map((p) => ({
        proof: {
          key: p.proof.key, checksum: p.proof.checksum, fileType: p.proof.fileType,
          fileSize: p.proof.fileSize, originalFilename: p.proof.originalFilename,
        },
        receivedAmount: p.receivedAmount, paymentDate: p.paymentDate, paymentMethod: p.paymentMethod,
        transactionId: p.transactionId, confirmations: p.confirmations,
        varianceReason: p.varianceReason || undefined, manualEntryNoOcr: false,
      })),
    });
  }

  return (
    <div className="space-y-6">
      {/* Learner + basic details */}
      <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Learner details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field l="Full name"><input className={input} value={learner.fullName} onChange={(e) => setLearner({ ...learner, fullName: e.target.value })} /></Field>
          <Field l="Date of birth"><input type="date" className={input} value={learner.dob} onChange={(e) => setLearner({ ...learner, dob: e.target.value })} /></Field>
          <Field l="Door / plot no."><input className={input} value={learner.doorNo} onChange={(e) => setLearner({ ...learner, doorNo: e.target.value })} /></Field>
          <Field l="Street / area"><input className={input} value={learner.street} onChange={(e) => setLearner({ ...learner, street: e.target.value })} /></Field>
          <Field l="Full address" wide><input className={input} value={learner.address} onChange={(e) => setLearner({ ...learner, address: e.target.value })} /></Field>
          <Field l="District"><input className={input} value={learner.district} onChange={(e) => setLearner({ ...learner, district: e.target.value })} /></Field>
          <Field l="State"><input className={input} placeholder="Not in message — please add" value={learner.state} onChange={(e) => setLearner({ ...learner, state: e.target.value })} /></Field>
          <Field l="Pincode"><input className={input} value={learner.pincode} onChange={(e) => setLearner({ ...learner, pincode: e.target.value })} /></Field>
          <Field l="Email"><input className={input} value={learner.email} onChange={(e) => setLearner({ ...learner, email: e.target.value })} /></Field>
          <Field l="Mobile"><input className={input} value={learner.mobile} onChange={(e) => setLearner({ ...learner, mobile: e.target.value })} /></Field>
        </div>
      </section>

      {/* Program + fee cross-check */}
      <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Program & fee</h2>
        {preview.course.programName && <p className="text-xs text-slate-500">From the message: “{preview.course.programName}”</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field l="Program">
            <select className={input} value={course.program} onChange={(e) => setCourse({ ...course, program: e.target.value as Program })}>
              <option value="">Select…</option>
              {PROGRAMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field l="Plan">
            <select className={input} value={course.plan} onChange={(e) => setCourse({ ...course, plan: e.target.value as Plan })}>
              <option value="">Select…</option>
              <option value={Plan.ADVANCED}>Advanced</option>
              <option value={Plan.PREMIUM}>Premium</option>
            </select>
          </Field>
          {course.program === Program.COMBO_ALL_THREE && (
            <Field l="Combo mode">
              <select className={input} value={course.comboMode} onChange={(e) => setCourse({ ...course, comboMode: e.target.value as ComboMode })}>
                <option value="">Select…</option>
                <option value={ComboMode.SINGLE_SHOT}>Single Shot</option>
                <option value={ComboMode.DOUBLE_SHOT}>Double Shot</option>
              </select>
            </Field>
          )}
          <Field l="Commencing date"><input type="date" className={input} value={course.commencingDate} onChange={(e) => setCourse({ ...course, commencingDate: e.target.value })} /></Field>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
          <span className="text-slate-500">Course fee — </span>
          message says <strong>{preview.course.textCourseFee ? formatINR(preview.course.textCourseFee) : "—"}</strong>
          {" · "}system (Pricing Master) computes <strong>{preview.course.systemFee ? formatINR(preview.course.systemFee) : "select program/plan"}</strong>
          {preview.course.feeMismatch && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              These differ — the system fee applies. Please double-check the program, plan and mode.
            </p>
          )}
        </div>
      </section>

      {/* Payments — one card per proof (BR-20 per-field confirmation) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Payments ({payments.length})</h2>
          <span className="text-xs text-slate-500">
            Received total <strong>{formatINR(receivedTotal)}</strong>
            {preview.course.systemFee && <> of {formatINR(preview.course.systemFee)}</>}
          </span>
        </div>
        {payments.map((p, i) => (
          <div key={i} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[120px_1fr] dark:border-slate-800">
            <div className="flex flex-col items-center gap-1">
              {p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.previewUrl} alt={`Proof ${i + 1}`} className="max-h-32 w-full rounded-md border border-slate-200 object-contain dark:border-slate-700" />
              ) : (
                <div className="flex h-24 w-full items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">PDF</div>
              )}
              <span className="max-w-full truncate text-[11px] text-slate-400" title={p.proof.originalFilename}>{p.proof.originalFilename}</span>
              {p.payerName && <span className="text-[11px] text-slate-500">Payer: {p.payerName}</span>}
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ConfirmField l="Amount received" ocr={p.proof.ocr.fields.receivedAmount != null} checked={p.confirmations.receivedAmount} onCheck={(v) => setConfirm(i, "receivedAmount", v)}>
                  <input className={input} value={p.receivedAmount} onChange={(e) => setPay(i, { receivedAmount: e.target.value })} />
                </ConfirmField>
                <ConfirmField l="Transaction ID" ocr={p.proof.ocr.fields.transactionId != null} checked={p.confirmations.transactionId} onCheck={(v) => setConfirm(i, "transactionId", v)}>
                  <input className={input} value={p.transactionId} onChange={(e) => setPay(i, { transactionId: e.target.value })} />
                </ConfirmField>
                <ConfirmField l="Payment date" ocr={p.proof.ocr.fields.paymentDate != null} checked={p.confirmations.paymentDate} onCheck={(v) => setConfirm(i, "paymentDate", v)}>
                  <input type="date" className={input} value={toDateInput(p.paymentDate)} onChange={(e) => setPay(i, { paymentDate: fromDateInput(e.target.value) })} />
                </ConfirmField>
                <ConfirmField l="Method" ocr={p.proof.ocr.fields.paymentMethod != null} checked={p.confirmations.paymentMethod} onCheck={(v) => setConfirm(i, "paymentMethod", v)}>
                  <select className={input} value={p.paymentMethod} onChange={(e) => setPay(i, { paymentMethod: e.target.value as PaymentMethod })}>
                    {Object.values(PaymentMethod).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </ConfirmField>
              </div>
              <Field l="Note / reason (for a part payment or any variance)">
                <input className={input} value={p.varianceReason} onChange={(e) => setPay(i, { varianceReason: e.target.value })} />
              </Field>
            </div>
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={submit} disabled={submitting || !canConfirm} className={navyBtn}>
          {submitting ? "Saving…" : submitLabel}
        </button>
        {onBack && (
          <button type="button" onClick={onBack} disabled={submitting} className="text-sm text-slate-500 hover:underline">
            Back
          </button>
        )}
        {!canConfirm && <span className="text-xs text-slate-400">Fill every field and tick each confirmed value to continue.</span>}
      </div>
    </div>
  );
}

function Field({ l, wide, children }: { l: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
      <label className={labelCls}>{l}</label>
      {children}
    </div>
  );
}

function ConfirmField({
  l, ocr, checked, onCheck, children,
}: { l: string; ocr: boolean; checked: boolean; onCheck: (v: boolean) => void; children: React.ReactNode }) {
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

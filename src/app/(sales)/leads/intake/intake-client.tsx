"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ComboMode, PaymentMethod, Plan, Program } from "@prisma/client";
import { formatINR } from "@/lib/format";
import { extractEnrollmentBundleAction, commitEnrollmentBundleAction } from "@/app/(sales)/leads/enrollment-actions";

// ── Local view-types (the intake service is server-only; mirror its preview shape) ──
type OcrField = "receivedAmount" | "paymentDate" | "transactionId" | "paymentMethod";
interface StagedProof {
  key: string; checksum: string; fileType: string; fileSize: number; originalFilename: string;
  ocr: { ok: boolean; fields: Record<string, string>; confidence: Record<string, number> };
}
interface PreviewPayment {
  proof: StagedProof;
  receivedAmount?: string; paymentDate?: string; transactionId?: string;
  paymentMethod?: PaymentMethod; payerName?: string;
}
interface Preview {
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

// Editable review state.
interface PaymentDraft {
  proof: StagedProof;
  previewUrl: string | null; // object URL for the staged (not-yet-persisted) proof image
  isPdf: boolean;
  receivedAmount: string; paymentDate: string; transactionId: string; paymentMethod: PaymentMethod;
  payerName: string;
  confirmations: Record<OcrField, boolean>;
  varianceReason: string;
}

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const label = "text-xs font-medium text-slate-600 dark:text-slate-300";
const navyBtn =
  "rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50";

const PROGRAMS: { value: Program; label: string }[] = [
  { value: Program.DATA_ANALYST, label: "Data Analyst" },
  { value: Program.ADV_DATA_SCIENCE_AI, label: "Advanced Data Science & AI" },
  { value: Program.AGENTIC_AI_GENAI, label: "Agentic AI & Gen AI" },
  { value: Program.COMBO_ALL_THREE, label: "Combo — All Three" },
];

function toDateInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}
/**
 * Exact sum of 2-dp money strings → "x.xx", for the on-screen received-total guidance only.
 * Integer-paise string math — no floats, no Number(<money>) coercion (FR-REC-07). The
 * authoritative balance is always server-computed from APPROVED payments; this is a hint.
 */
function sumMoney(values: string[]): string {
  let totalMinor = 0;
  for (const v of values) {
    const [whole, frac = ""] = (v || "0").replace(/[^\d.]/g, "").split(".");
    totalMinor += (whole === "" ? 0 : parseInt(whole, 10)) * 100 + parseInt(`${frac}00`.slice(0, 2), 10);
  }
  return `${Math.floor(totalMinor / 100)}.${String(totalMinor % 100).padStart(2, "0")}`;
}
function fromDateInput(value: string): string {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : "";
}

export function IntakeClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "review">("upload");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extracting, extract] = useTransition();
  const [committing, commit] = useTransition();

  // Review state
  const [learner, setLearner] = useState({
    fullName: "", dob: "", doorNo: "", street: "", address: "", district: "", state: "",
    pincode: "", email: "", mobile: "", leadSource: "Enrollment intake", remarks: "",
  });
  const [course, setCourse] = useState<{
    program: Program | ""; plan: Plan | ""; comboMode: ComboMode | ""; commencingDate: string;
    programName: string; textCourseFee?: string; systemFee?: string; feeMismatch: boolean;
  }>({ program: "", plan: "", comboMode: "", commencingDate: "", programName: "", feeMismatch: false });
  const [payments, setPayments] = useState<PaymentDraft[]>([]);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
  }

  function loadPreview(preview: Preview, picked: File[]) {
    setLearner((l) => ({
      ...l,
      fullName: preview.learner.fullName ?? "",
      dob: toDateInput(preview.learner.dob),
      doorNo: preview.learner.doorNo,
      street: preview.learner.street,
      address: preview.learner.address,
      district: preview.learner.district,
      state: preview.learner.state,
      pincode: preview.learner.pincode ?? "",
      email: preview.learner.email ?? "",
      mobile: preview.learner.mobile ?? "",
    }));
    setCourse({
      program: preview.course.program ?? "",
      plan: preview.course.plan ?? "",
      comboMode: preview.course.comboMode ?? "",
      commencingDate: toDateInput(preview.course.commencingDate),
      programName: preview.course.programName ?? "",
      textCourseFee: preview.course.textCourseFee,
      systemFee: preview.course.systemFee,
      feeMismatch: preview.course.feeMismatch,
    });
    const multi = preview.payments.length > 1;
    setPayments(
      preview.payments.map((p, i) => {
        const file = picked[i];
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
    setWarnings(preview.warnings);
  }

  function onExtract() {
    setError(null); setWarnings([]);
    extract(async () => {
      const fd = new FormData();
      fd.append("text", text);
      for (const f of files) fd.append("file", f);
      const res = await extractEnrollmentBundleAction(fd);
      if ("error" in res) return setError(res.error ?? "Couldn't read the uploads. Please try again.");
      loadPreview(res.preview as Preview, files);
      setStep("review");
    });
  }

  function setPay(i: number, patch: Partial<PaymentDraft>) {
    setPayments((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function setConfirm(i: number, field: OcrField, value: boolean) {
    setPayments((ps) => ps.map((p, idx) => (idx === i ? { ...p, confirmations: { ...p.confirmations, [field]: value } } : p)));
  }

  // BR-20: every OCR-extracted field on every proof must be actively confirmed.
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

  const receivedTotal = sumMoney(payments.map((p) => p.receivedAmount));

  function onConfirm() {
    setError(null); setWarnings([]);
    commit(async () => {
      const res = await commitEnrollmentBundleAction({
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
          receivedAmount: p.receivedAmount,
          paymentDate: p.paymentDate,
          paymentMethod: p.paymentMethod,
          transactionId: p.transactionId,
          confirmations: p.confirmations,
          varianceReason: p.varianceReason || undefined,
          manualEntryNoOcr: false,
        })),
      });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please check the highlighted fields and try again.");
      const data = res?.data;
      if (data?.ok) {
        if (data.warnings.length > 0) {
          setWarnings(data.warnings);
          // Give the salesperson a moment to read, then go to the lead to finish up.
          setTimeout(() => router.push(`/leads/${data.leadId}`), 2500);
        } else {
          router.push(`/leads/${data.leadId}`);
        }
      }
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Enrollment from uploads</h1>
        <p className="mt-1 text-sm text-slate-500">
          Paste the enrollment message and add the payment screenshot(s)/PDF(s). We read everything —
          learner details, program, and each payment — for you to check and confirm. Nothing is typed by hand.
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {step === "upload" && (
        <section className="space-y-4 rounded-xl border border-brand-blue/30 bg-brand-blue-50/60 p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="space-y-1">
            <label className={label}>Enrollment message</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"Paste the *Enrollment Confirmation* message here (Full Name, DOB, Address, Program, Course fee, …)"}
              className={input}
            />
          </div>
          <div className="space-y-1">
            <label className={label}>Payment proofs (screenshot / PDF — add all of them)</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              multiple
              onChange={onPickFiles}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-navy-700 dark:text-slate-300"
            />
            {files.length > 0 && (
              <p className="text-xs text-slate-500">{files.length} file{files.length > 1 ? "s" : ""} selected: {files.map((f) => f.name).join(", ")}</p>
            )}
          </div>
          <button type="button" onClick={onExtract} disabled={extracting || (!text.trim() && files.length === 0)} className={navyBtn}>
            {extracting ? "Reading…" : "Read & review"}
          </button>
        </section>
      )}

      {step === "review" && (
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
            {course.programName && <p className="text-xs text-slate-500">From the message: “{course.programName}”</p>}
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
              message says <strong>{course.textCourseFee ? formatINR(course.textCourseFee) : "—"}</strong>
              {" · "}system (Pricing Master) computes <strong>{course.systemFee ? formatINR(course.systemFee) : "select program/plan"}</strong>
              {course.feeMismatch && (
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
                {course.systemFee && <> of {formatINR(course.systemFee)}</>}
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
            <button type="button" onClick={onConfirm} disabled={committing || !canConfirm} className={navyBtn}>
              {committing ? "Creating…" : "Confirm & create enrollment"}
            </button>
            <button type="button" onClick={() => setStep("upload")} disabled={committing} className="text-sm text-slate-500 hover:underline">
              Back
            </button>
            {!canConfirm && <span className="text-xs text-slate-400">Fill every field and tick each confirmed value to continue.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ l, wide, children }: { l: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
      <label className={label}>{l}</label>
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
        <label className={label}>{l}</label>
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

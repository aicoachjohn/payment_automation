"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Program, Plan, ComboMode, ConcessionThresholdType } from "@prisma/client";
import { FeeBreakdown } from "@/components/shared/fee-breakdown";
import { BASIC_DETAILS_ERROR } from "@/lib/schemas";
import {
  updateBasicDetailsAction,
  markInterestedAction,
  selectCourseAction,
  requestConcessionAction,
  decideConcessionAction,
  checkDuplicateAction,
  voidLeadAction,
} from "@/app/(sales)/leads/actions";
import { extractEnrollmentBundleAction, applyEnrollmentBundleAction } from "@/app/(sales)/leads/enrollment-actions";
import {
  EnrollmentBundleForm,
  type BundlePreview,
  type ReviewedBundleValue,
} from "@/app/(sales)/leads/enrollment-bundle-form";

export interface LeadDetail {
  id: string;
  fullName: string;
  dob: string | null;
  doorNo: string | null;
  street: string | null;
  address: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  email: string | null;
  mobile: string | null;
  leadSource: string | null;
  remarks: string | null;
  status: string;
  enrollment: {
    program: Program; plan: Plan; comboMode: ComboMode | null;
    commencingDate: string | null; batch: string | null; courseStartedFlag: boolean;
    standardFee: string | null; baseFee: string | null; gstAmount: string | null; gstPercent: string;
    concessionAmount: string; concessionReason: string | null; concessionStatus: string;
    finalApprovedFee: string | null; feeLocked: boolean;
  } | null;
}

const input =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";
const btn =
  "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";
const card = "space-y-4 rounded-lg border border-slate-200 p-5 dark:border-slate-800";

export function LeadDetailClient({ lead, canApproveConcession }: { lead: LeadDetail; canApproveConcession: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [banner, setBanner] = useState<string | null>(null);

  function run(fn: () => Promise<{ serverError?: string; validationErrors?: unknown } | undefined>, onOk?: () => void) {
    setBanner(null);
    start(async () => {
      const res = await fn();
      if (res?.serverError) return setBanner(res.serverError);
      if (res?.validationErrors) return setBanner(BASIC_DETAILS_ERROR);
      onOk?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{lead.fullName}</h1>
          <p className="text-sm text-slate-500">Status: {lead.status}</p>
        </div>
        <div className="flex items-center gap-2">
          {lead.status === "NEW_LEAD" && (
            <button className={btn} disabled={pending} onClick={() => run(() => markInterestedAction({ leadId: lead.id }))}>
              Mark interested
            </button>
          )}
          <DeleteLeadButton leadId={lead.id} leadName={lead.fullName} />
        </div>
      </div>

      {banner && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{banner}</p>}

      <AutofillPanel leadId={lead.id} />

      {/* key → remount so the forms re-init from freshly saved data after an auto-fill/refresh */}
      <BasicDetails
        key={`bd:${lead.dob}|${lead.doorNo}|${lead.street}|${lead.address}|${lead.district}|${lead.state}|${lead.pincode}|${lead.email}|${lead.mobile}`}
        lead={lead}
        pending={pending}
        run={run}
      />

      <CourseSelection
        key={`cs:${lead.enrollment?.program}|${lead.enrollment?.plan}|${lead.enrollment?.comboMode}|${lead.enrollment?.commencingDate}`}
        lead={lead}
        pending={pending}
        run={run}
      />

      {lead.enrollment?.standardFee && (
        <div className={card}>
          <h2 className="text-lg font-semibold">Fee</h2>
          <div className="max-w-sm">
            <FeeBreakdown
              baseFee={lead.enrollment.baseFee!}
              gstAmount={lead.enrollment.gstAmount!}
              gstPercent={lead.enrollment.gstPercent}
              standardFee={lead.enrollment.standardFee}
              concessionAmount={lead.enrollment.concessionAmount}
              finalApprovedFee={lead.enrollment.finalApprovedFee}
            />
          </div>
          <ConcessionSection lead={lead} pending={pending} run={run} canApprove={canApproveConcession} />
        </div>
      )}
    </div>
  );
}

function BasicDetails({ lead, pending, run }: { lead: LeadDetail; pending: boolean; run: (fn: () => Promise<{ serverError?: string; validationErrors?: unknown } | undefined>) => void }) {
  const [f, setF] = useState({
    fullName: lead.fullName ?? "", dob: lead.dob ? lead.dob.slice(0, 10) : "",
    doorNo: lead.doorNo ?? "", street: lead.street ?? "", address: lead.address ?? "",
    district: lead.district ?? "", state: lead.state ?? "", pincode: lead.pincode ?? "",
    email: lead.email ?? "", mobile: lead.mobile ?? "", leadSource: lead.leadSource ?? "", remarks: lead.remarks ?? "",
  });
  const [dup, setDup] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function checkDup(field: "mobile" | "email", value: string) {
    if (!value.trim()) return setDup(null);
    const res = await checkDuplicateAction({ field, value });
    const hit = res?.data?.duplicate;
    setDup(hit ? `Existing lead: ${hit.fullName}, owned by ${hit.ownerName}.` : null);
  }

  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateBasicDetailsAction({ leadId: lead.id, ...f, dob: f.dob ? new Date(f.dob).toISOString() : "" }));
      }}
    >
      <h2 className="text-lg font-semibold">Basic details</h2>
      <p className="text-xs text-slate-500">Entered once here; reused everywhere (BR-02).</p>
      {dup && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{dup}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Full name" req><input className={input} value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label="Date of birth"><input type="date" className={input} value={f.dob} onChange={set("dob")} /></Field>
        <Field label="Door no."><input className={input} value={f.doorNo} onChange={set("doorNo")} /></Field>
        <Field label="Street"><input className={input} value={f.street} onChange={set("street")} /></Field>
        <Field label="Address"><input className={input} value={f.address} onChange={set("address")} /></Field>
        <Field label="District"><input className={input} value={f.district} onChange={set("district")} /></Field>
        <Field label="State"><input className={input} value={f.state} onChange={set("state")} /></Field>
        <Field label="Pincode"><input className={input} value={f.pincode} onChange={set("pincode")} /></Field>
        <Field label="Email" req><input className={input} value={f.email} onChange={set("email")} onBlur={() => checkDup("email", f.email)} /></Field>
        <Field label="Mobile" req><input className={input} value={f.mobile} onChange={set("mobile")} onBlur={() => checkDup("mobile", f.mobile)} /></Field>
        <Field label="Lead source"><input className={input} value={f.leadSource} onChange={set("leadSource")} /></Field>
        <Field label="Remarks"><input className={input} value={f.remarks} onChange={set("remarks")} /></Field>
      </div>
      <button type="submit" className={btn} disabled={pending}>Save details</button>
    </form>
  );
}

function CourseSelection({ lead, pending, run }: { lead: LeadDetail; pending: boolean; run: (fn: () => Promise<{ serverError?: string; validationErrors?: unknown } | undefined>) => void }) {
  const e = lead.enrollment;
  const [program, setProgram] = useState<Program>(e?.program ?? Program.COMBO_ALL_THREE);
  const [plan, setPlan] = useState<Plan>(e?.plan ?? Plan.PREMIUM);
  const [comboMode, setComboMode] = useState<ComboMode>(e?.comboMode ?? ComboMode.DOUBLE_SHOT);
  const [commencingDate, setCommencingDate] = useState(e?.commencingDate ? e.commencingDate.slice(0, 10) : "");
  const [batch, setBatch] = useState(e?.batch ?? "");
  const isCombo = program === Program.COMBO_ALL_THREE;

  return (
    <form
      className={card}
      onSubmit={(ev) => {
        ev.preventDefault();
        run(() =>
          selectCourseAction({
            leadId: lead.id, program, plan,
            comboMode: isCombo ? comboMode : null,
            commencingDate: commencingDate ? new Date(commencingDate).toISOString() : null,
            batch: batch || null,
          }),
        );
      }}
    >
      <h2 className="text-lg font-semibold">Course &amp; plan</h2>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Program" req><select className={input} value={program} onChange={(ev) => setProgram(ev.target.value as Program)}>{Object.values(Program).map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
        <Field label="Plan" req><select className={input} value={plan} onChange={(ev) => setPlan(ev.target.value as Plan)}>{Object.values(Plan).map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
        {isCombo && <Field label="Combo mode"><select className={input} value={comboMode} onChange={(ev) => setComboMode(ev.target.value as ComboMode)}>{Object.values(ComboMode).map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>}
        <Field label="Commencing date"><input type="date" className={input} value={commencingDate} onChange={(ev) => setCommencingDate(ev.target.value)} /></Field>
        <Field label="Batch"><input className={input} value={batch} onChange={(ev) => setBatch(ev.target.value)} /></Field>
        <button type="submit" className={btn} disabled={pending}>Save &amp; calculate fee</button>
      </div>
    </form>
  );
}

function ConcessionSection({ lead, pending, run, canApprove }: { lead: LeadDetail; pending: boolean; run: (fn: () => Promise<{ serverError?: string; validationErrors?: unknown } | undefined>) => void; canApprove: boolean }) {
  const e = lead.enrollment!;
  const [type, setType] = useState<ConcessionThresholdType>(ConcessionThresholdType.AMOUNT);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [decisionReason, setDecisionReason] = useState("");

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Concession</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${e.concessionStatus === "PENDING_APPROVAL" ? "bg-amber-100 text-amber-800" : e.concessionStatus === "REJECTED" ? "bg-red-100 text-red-700" : e.concessionStatus === "NONE" ? "bg-slate-100 text-slate-600" : "bg-green-100 text-green-700"}`}>
          {e.concessionStatus}
        </span>
      </div>

      {!e.feeLocked && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); run(() => requestConcessionAction({ leadId: lead.id, concessionType: type, concessionValue: value, reason })); }}>
          <Field label="Type"><select className={input} value={type} onChange={(ev) => setType(ev.target.value as ConcessionThresholdType)}><option value="AMOUNT">Amount ₹</option><option value="PERCENTAGE">Percent %</option></select></Field>
          <Field label="Value"><input className={input} value={value} onChange={(ev) => setValue(ev.target.value)} /></Field>
          <Field label="Reason (required)"><input className={input} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
          <button type="submit" className={btn} disabled={pending}>Request concession</button>
        </form>
      )}

      {canApprove && e.concessionStatus === "PENDING_APPROVAL" && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-amber-50 p-3 dark:bg-amber-950">
          <Field label="Decision reason"><input className={input} value={decisionReason} onChange={(ev) => setDecisionReason(ev.target.value)} /></Field>
          <button className={btn} disabled={pending} onClick={() => run(() => decideConcessionAction({ leadId: lead.id, decision: "APPROVE", reason: decisionReason || "Approved" }))}>Approve</button>
          <button className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50" disabled={pending} onClick={() => run(() => decideConcessionAction({ leadId: lead.id, decision: "REJECT", reason: decisionReason || "Rejected" }))}>Reject</button>
        </div>
      )}
    </div>
  );
}

/**
 * "Auto-fill from uploads" on an existing lead — the salesperson drops the payment
 * screenshot(s)/PDF(s) and pastes the message; the tool fills THIS lead's basic details,
 * course and payments (reusing the same extract → review → apply engine as the intake page).
 */
function AutofillPanel({ leadId }: { leadId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extracting, extract] = useTransition();
  const [applying, apply] = useTransition();

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
  const navyBtn = "rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50";

  function onExtract() {
    setError(null); setWarnings([]);
    extract(async () => {
      const fd = new FormData();
      fd.append("text", text);
      for (const f of files) fd.append("file", f);
      const res = await extractEnrollmentBundleAction(fd);
      if ("error" in res) return setError(res.error ?? "Couldn't read the uploads. Please try again.");
      setPreview(res.preview as BundlePreview);
      setWarnings((res.preview as BundlePreview).warnings);
    });
  }

  function onApply(bundle: ReviewedBundleValue) {
    setError(null); setWarnings([]);
    apply(async () => {
      const res = await applyEnrollmentBundleAction({ leadId, ...bundle });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please check the highlighted fields and try again.");
      const data = res?.data;
      if (data?.ok) {
        setPreview(null); setText(""); setFiles([]); setOpen(false);
        setWarnings(data.warnings);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-brand-blue/40 bg-brand-blue-50/60 p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Auto-fill from uploads</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Drop the payment screenshot(s)/PDF(s) and paste the enrollment message — we fill this lead&apos;s
            details, course and payments. Nothing typed by hand.
          </p>
        </div>
        {!open && !preview && (
          <button type="button" onClick={() => setOpen(true)} className={navyBtn}>Upload &amp; auto-fill</button>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {open && !preview && (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"Paste the *Enrollment Confirmation* message (Full Name, DOB, Address, Program, Course fee, …)"}
            className={inputCls}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-navy-700 dark:text-slate-300"
          />
          {files.length > 0 && (
            <p className="text-xs text-slate-500">{files.length} file{files.length > 1 ? "s" : ""}: {files.map((f) => f.name).join(", ")}</p>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onExtract} disabled={extracting || (!text.trim() && files.length === 0)} className={navyBtn}>
              {extracting ? "Reading…" : "Read & fill"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={extracting} className="text-sm text-slate-500 hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {preview && (
        <div className="pt-2">
          <EnrollmentBundleForm
            preview={preview}
            files={files}
            submitLabel="Apply to this lead"
            submitting={applying}
            onSubmit={onApply}
            onBack={() => setPreview(null)}
          />
        </div>
      )}
    </section>
  );
}

/** Remove (void) a lead — soft delete with a mandatory reason; kept in history (BR-21/BR-26). */
function DeleteLeadButton({ leadId, leadName }: { leadId: string; leadName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const res = await voidLeadAction({ leadId, reason });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please give a short reason (at least 3 characters).");
      if (res?.data?.ok) router.push("/sales");
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
      >
        Delete lead
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-medium text-brand-navy dark:text-slate-100">Remove {leadName}?</p>
          <p className="mt-0.5 text-xs text-slate-500">
            The lead is voided (hidden from your lists) but kept in history with your reason. This cannot be undone here.
          </p>
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          <input
            className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="Reason (required) — e.g. duplicate / test / wrong number"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={pending || reason.trim().length < 3}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Removing…" : "Confirm delete"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(null); }} className="ml-auto text-xs text-slate-400 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      <span>{label}{req && <span className="text-red-500" title="Required"> *</span>}</span>
      {children}
    </label>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extractEnrollmentBundleAction, commitEnrollmentBundleAction } from "@/app/(sales)/leads/enrollment-actions";
import {
  EnrollmentBundleForm,
  type BundlePreview,
  type ReviewedBundleValue,
} from "@/app/(sales)/leads/enrollment-bundle-form";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const labelCls = "text-xs font-medium text-slate-600 dark:text-slate-300";
const navyBtn =
  "rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50";

export function IntakeClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "review">("upload");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extracting, extract] = useTransition();
  const [committing, commit] = useTransition();

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
      setStep("review");
    });
  }

  function onCommit(bundle: ReviewedBundleValue) {
    setError(null); setWarnings([]);
    commit(async () => {
      const res = await commitEnrollmentBundleAction(bundle);
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please check the highlighted fields and try again.");
      const data = res?.data;
      if (data?.ok) {
        if (data.warnings.length > 0) {
          setWarnings(data.warnings);
          setTimeout(() => router.push(`/leads/${data.leadId}`), 2500);
        } else {
          router.push(`/leads/${data.leadId}`);
        }
      }
    });
  }

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
            <label className={labelCls}>Enrollment message</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"Paste the *Enrollment Confirmation* message here (Full Name, DOB, Address, Program, Course fee, …)"}
              className={input}
            />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Payment proofs (screenshot / PDF — add all of them at once)</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
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

      {step === "review" && preview && (
        <EnrollmentBundleForm
          preview={preview}
          files={files}
          submitLabel="Confirm & create enrollment"
          submitting={committing}
          onSubmit={onCommit}
          onBack={() => setStep("upload")}
        />
      )}
    </div>
  );
}

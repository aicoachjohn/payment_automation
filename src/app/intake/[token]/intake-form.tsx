"use client";

import { useState, useTransition } from "react";
import { Program, Plan } from "@prisma/client";
import { submitIntakeAction } from "@/app/intake/actions";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const labelCls = "text-xs font-medium text-slate-600 dark:text-slate-300";

const PROGRAMS: { value: Program; label: string }[] = [
  { value: Program.DATA_ANALYST, label: "Data Analyst" },
  { value: Program.ADV_DATA_SCIENCE_AI, label: "Advanced Data Science & AI" },
  { value: Program.AGENTIC_AI_GENAI, label: "Agentic AI & Gen AI" },
  { value: Program.COMBO_ALL_THREE, label: "Combo — All Three" },
];

const EMPTY = {
  fullName: "", dob: "", doorNo: "", street: "", address: "", district: "", state: "",
  pincode: "", email: "", mobile: "", interestedProgram: "" as Program | "", interestedPlan: "" as Plan | "",
};

export function IntakeForm({ token }: { token: string }) {
  const [f, setF] = useState(EMPTY);
  const [company, setCompany] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const ready =
    f.fullName.trim().length >= 2 && f.dob && f.doorNo.trim() && f.street.trim() && f.address.trim() &&
    f.district.trim() && f.state.trim() && /^\d{6}$/.test(f.pincode) && /.+@.+\..+/.test(f.email) &&
    /^(\+?\d{1,3}[- ]?)?\d{10}$/.test(f.mobile) && f.interestedProgram && f.interestedPlan;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await submitIntakeAction({ token, ...f, interestedProgram: f.interestedProgram as Program, interestedPlan: f.interestedPlan as Plan, company });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please check the highlighted fields and try again.");
      const data = res?.data;
      if (data?.ok) setDone(true);
      else setError(data?.error ?? "Something went wrong. Please try again.");
    });
  }

  if (done) {
    return (
      <div className="space-y-2 text-center">
        <h1 className="text-lg font-semibold text-brand-navy dark:text-slate-100">Thank you! 🎉</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Your details have been submitted to your ProITbridge advisor. They&apos;ll be in touch shortly to
          complete your enrollment.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <h1 className="text-lg font-semibold text-brand-navy dark:text-slate-100">Your enrollment details</h1>
        <p className="mt-0.5 text-xs text-slate-500">All fields are required. Your advisor will handle the payment separately.</p>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field l="Full name"><input className={input} value={f.fullName} onChange={set("fullName")} /></Field>
        <Field l="Date of birth"><input type="date" className={input} value={f.dob} onChange={set("dob")} /></Field>
        <Field l="Door / plot no."><input className={input} value={f.doorNo} onChange={set("doorNo")} /></Field>
        <Field l="Street / area"><input className={input} value={f.street} onChange={set("street")} /></Field>
        <Field l="Address" wide><input className={input} value={f.address} onChange={set("address")} /></Field>
        <Field l="District"><input className={input} value={f.district} onChange={set("district")} /></Field>
        <Field l="State"><input className={input} value={f.state} onChange={set("state")} /></Field>
        <Field l="Pincode"><input className={input} inputMode="numeric" value={f.pincode} onChange={set("pincode")} /></Field>
        <Field l="Email"><input className={input} type="email" value={f.email} onChange={set("email")} /></Field>
        <Field l="Mobile"><input className={input} value={f.mobile} onChange={set("mobile")} /></Field>
        <Field l="Program you're interested in">
          <select className={input} value={f.interestedProgram} onChange={set("interestedProgram")}>
            <option value="">Select…</option>
            {PROGRAMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field l="Plan">
          <select className={input} value={f.interestedPlan} onChange={set("interestedPlan")}>
            <option value="">Select…</option>
            <option value={Plan.ADVANCED}>Advanced</option>
            <option value={Plan.PREMIUM}>Premium</option>
          </select>
        </Field>
      </div>

      {/* Honeypot — hidden from humans; bots fill it and are silently dropped. */}
      <input
        type="text"
        name="company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <button
        type="submit"
        disabled={pending || !ready}
        className="w-full rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit my details"}
      </button>
    </form>
  );
}

function Field({ l, wide, children }: { l: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
      <label className={labelCls}>{l} <span className="text-red-500">*</span></label>
      {children}
    </div>
  );
}

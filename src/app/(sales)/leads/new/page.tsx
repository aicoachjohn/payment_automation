"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeadAction, checkDuplicateAction, autofillLeadFromTextAction, autofillLeadFromFileAction } from "@/app/(sales)/leads/actions";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";

interface Dup { leadId: string; fullName: string; ownerName: string }
interface LeadFields { fullName?: string; mobile?: string; email?: string; leadSource?: string }

export default function NewLeadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [paste, setPaste] = useState("");
  const [dup, setDup] = useState<Dup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [filling, fill] = useTransition();

  function applyFields(fields: LeadFields, ok: boolean) {
    if (fields.fullName) setFullName(fields.fullName);
    if (fields.mobile) setMobile(fields.mobile);
    if (fields.email) setEmail(fields.email);
    if (fields.leadSource) setLeadSource(fields.leadSource);
    const found = [fields.fullName && "name", fields.mobile && "mobile", fields.email && "email", fields.leadSource && "source"].filter(Boolean);
    setNotice(
      ok && found.length
        ? `Read ${found.join(", ")} automatically — please review and edit anything before creating the lead.`
        : "Couldn't read the details automatically. Please type them below, or try a clearer file.",
    );
    if (fields.mobile) void checkDup("mobile", fields.mobile);
    else if (fields.email) void checkDup("email", fields.email);
  }

  function autofillText() {
    setError(null); setNotice(null);
    fill(async () => {
      const res = await autofillLeadFromTextAction({ text: paste });
      if (res?.serverError) return setError(res.serverError);
      if (res?.data) applyFields(res.data.fields ?? {}, res.data.ok);
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setNotice(null);
    fill(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await autofillLeadFromFileAction(fd);
      if (res?.error) return setError(res.error);
      if (res && "ok" in res) applyFields(res.fields ?? {}, res.ok ?? false);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  async function checkDup(field: "mobile" | "email", value: string) {
    if (!value.trim()) return;
    const res = await checkDuplicateAction({ field, value });
    setDup(res?.data?.duplicate ?? null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createLeadAction({ fullName, mobile: mobile || undefined, email: email || undefined, leadSource: leadSource || undefined });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please check the fields.");
      if (res?.data?.ok) router.push(`/leads/${res.data.leadId}`);
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">New lead</h1>

      {/* Auto-fill: paste a message or upload a screenshot/document (FR-SAL-08 assist) */}
      <section className="rounded-xl border border-brand-blue/30 bg-brand-blue-50/60 p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Auto-fill from a message or document</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Paste the enquiry / WhatsApp text, or upload a screenshot or document. We read the name, mobile, email and
          source so you don&apos;t type them. Review before creating.
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder={"Paste here, e.g.\nName: Priya Sharma\nMobile: 98765 43210\nEmail: priya@example.com\nSource: Instagram"}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={autofillText}
            disabled={filling || paste.trim().length < 2}
            className="rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50"
          >
            {filling ? "Reading…" : "Auto-fill"}
          </button>
          <span className="text-xs text-slate-400">or</span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={filling}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Upload screenshot / document
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" onChange={onFile} className="hidden" />
        </div>
      </section>

      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{notice}</p>
      )}
      {dup && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          A lead with this contact already exists: <strong>{dup.fullName}</strong>, owned by{" "}
          <strong>{dup.ownerName}</strong>. Creating a duplicate active enrollment is blocked.
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Full name</label>
          <input className={input} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Mobile</label>
          <input className={input} value={mobile} onChange={(e) => setMobile(e.target.value)} onBlur={() => checkDup("mobile", mobile)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Email</label>
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => checkDup("email", email)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Lead source</label>
          <input className={input} value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="Referral, Instagram, …" />
        </div>
        <button type="submit" disabled={pending || !!dup} className="w-full rounded-lg bg-brand-navy px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50">
          {pending ? "Creating…" : "Create lead"}
        </button>
      </form>
    </div>
  );
}

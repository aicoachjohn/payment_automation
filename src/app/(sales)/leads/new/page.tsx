"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeadAction, checkDuplicateAction } from "@/app/(sales)/leads/actions";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";

interface Dup { leadId: string; fullName: string; ownerName: string }

export default function NewLeadPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [dup, setDup] = useState<Dup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
      {dup && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          A lead with this contact already exists: <strong>{dup.fullName}</strong>, owned by{" "}
          <strong>{dup.ownerName}</strong>. Creating a duplicate active enrollment is blocked.
        </div>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
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
        <button type="submit" disabled={pending || !!dup} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {pending ? "Creating…" : "Create lead"}
        </button>
      </form>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { describeOverrideAction, performOverrideAction } from "@/app/(superadmin)/admin/actions";

/**
 * Override console. Every override is a two-step commit: PREVIEW the exact consequence
 * (FR-SA-15), then CONFIRM. The mandatory reason is enforced here and again server-side.
 * Nothing here can edit a payment amount, date or Transaction ID — those override kinds
 * do not exist (FR-SA-08, BR-24).
 */
type Kind =
  | "REVERSE_AUDIT" | "UNLOCK_FEE" | "REASSIGN_LEAD" | "APPROVE_CONCESSION"
  | "EXTEND_DEADLINE" | "REVERSE_OPS_TRANSFER" | "DELEGATED_AUDIT";

const KIND_LABEL: Record<Kind, string> = {
  REVERSE_AUDIT: "Reverse / reopen an audit decision",
  UNLOCK_FEE: "Unlock a locked fee",
  REASSIGN_LEAD: "Reassign a lead",
  APPROVE_CONCESSION: "Approve an above-threshold concession",
  EXTEND_DEADLINE: "Extend a 15-day deadline",
  REVERSE_OPS_TRANSFER: "Reverse an Operations transfer",
  DELEGATED_AUDIT: "Delegated audit (act as L1 auditor)",
};

export function OverrideConsole({ salespeople }: { salespeople: { id: string; name: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("REVERSE_AUDIT");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirmations, setConfirmations] = useState({ amountMatches: false, dateMatches: false, transactionIdMatches: false });
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function set(name: string, value: string) {
    setFields((f) => ({ ...f, [name]: value }));
    setPreview(null);
  }

  function buildInput(): Record<string, unknown> {
    const base: Record<string, unknown> = { kind, reason };
    switch (kind) {
      case "REVERSE_AUDIT": return { ...base, paymentId: fields.paymentId ?? "" };
      case "UNLOCK_FEE": return { ...base, enrollmentId: fields.enrollmentId ?? "" };
      case "REASSIGN_LEAD": return { ...base, leadId: fields.leadId ?? "", newSalespersonId: fields.newSalespersonId ?? "" };
      case "APPROVE_CONCESSION": return { ...base, leadId: fields.leadId ?? "" };
      case "EXTEND_DEADLINE": return { ...base, enrollmentId: fields.enrollmentId ?? "", days: fields.days ?? "" };
      case "REVERSE_OPS_TRANSFER": return { ...base, enrollmentId: fields.enrollmentId ?? "" };
      case "DELEGATED_AUDIT": return { ...base, paymentId: fields.paymentId ?? "", decision: fields.decision ?? "APPROVE", confirmations, varianceReason: fields.varianceReason };
    }
  }

  function doPreview() {
    setError(null); setDone(null);
    start(async () => {
      const res = await describeOverrideAction(buildInput() as never);
      if (res?.serverError) return setError(res.serverError);
      if (res?.data && "ok" in res.data && !res.data.ok) return setError(res.data.error);
      if (res?.data && "summary" in res.data) setPreview(res.data.summary!);
    });
  }

  function doCommit() {
    setError(null);
    start(async () => {
      const res = await performOverrideAction(buildInput() as never);
      if (res?.serverError) return setError(res.serverError);
      if (res?.data && "ok" in res.data && !res.data.ok) return setError(res.data.error);
      setDone("Override applied. A Super Admin Activity entry was written and the affected roles were notified.");
      setPreview(null); setReason(""); setFields({});
      setConfirmations({ amountMatches: false, dateMatches: false, transactionIdMatches: false });
      router.refresh();
    });
  }

  const reasonOk = reason.trim().length >= 3;

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <label className="flex flex-col gap-1 text-xs text-slate-500">Override type
        <select
          value={kind}
          onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); setDone(null); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          {Object.entries(KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>

      {/* Target-id fields per kind */}
      <div className="grid gap-3 md:grid-cols-2">
        {(kind === "REVERSE_AUDIT" || kind === "DELEGATED_AUDIT") && (
          <Field label="Payment ID" value={fields.paymentId ?? ""} onChange={(v) => set("paymentId", v)} />
        )}
        {(kind === "UNLOCK_FEE" || kind === "EXTEND_DEADLINE" || kind === "REVERSE_OPS_TRANSFER") && (
          <Field label="Enrollment ID" value={fields.enrollmentId ?? ""} onChange={(v) => set("enrollmentId", v)} />
        )}
        {(kind === "REASSIGN_LEAD" || kind === "APPROVE_CONCESSION") && (
          <Field label="Lead ID" value={fields.leadId ?? ""} onChange={(v) => set("leadId", v)} />
        )}
        {kind === "REASSIGN_LEAD" && (
          <label className="flex flex-col gap-1 text-xs text-slate-500">Reassign to
            <select value={fields.newSalespersonId ?? ""} onChange={(e) => set("newSalespersonId", e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
              <option value="">Select…</option>
              {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        {kind === "EXTEND_DEADLINE" && (
          <Field label="Extra days" value={fields.days ?? ""} onChange={(v) => set("days", v)} type="number" />
        )}
        {kind === "DELEGATED_AUDIT" && (
          <label className="flex flex-col gap-1 text-xs text-slate-500">Decision
            <select value={fields.decision ?? "APPROVE"} onChange={(e) => set("decision", e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
              <option value="APPROVE">Approve</option>
              <option value="CORRECTION">Correction required</option>
              <option value="REJECT">Reject</option>
            </select>
          </label>
        )}
      </div>

      {kind === "DELEGATED_AUDIT" && (fields.decision ?? "APPROVE") === "APPROVE" && (
        <div className="flex flex-wrap gap-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900">
          <span className="text-xs text-slate-500">Confirm each matches the proof:</span>
          {(["amountMatches", "dateMatches", "transactionIdMatches"] as const).map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" checked={confirmations[c]} onChange={(e) => { setConfirmations((p) => ({ ...p, [c]: e.target.checked })); setPreview(null); }} />
              {c === "amountMatches" ? "Amount" : c === "dateMatches" ? "Date" : "Txn ID"}
            </label>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs text-slate-500">Mandatory written reason
        <textarea value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} rows={2} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="Why is this override necessary?" />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{done}</p>}

      {!preview ? (
        <button type="button" onClick={doPreview} disabled={pending || !reasonOk} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
          {pending ? "Checking…" : "Preview consequence"}
        </button>
      ) : (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-900 dark:text-amber-200"><strong>Confirm:</strong> {preview}</p>
          <div className="flex gap-2">
            <button type="button" onClick={doCommit} disabled={pending} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {pending ? "Applying…" : "Confirm override"}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">{label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
    </label>
  );
}

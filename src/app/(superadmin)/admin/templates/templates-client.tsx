"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renderTemplate } from "@/lib/template";
import { setTemplateAction } from "./actions";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";

export function TemplatesClient({
  template: initialTemplate,
  bankDetails: initialBank,
  instruction: initialInstruction,
  whatsappEnabled: initialWa,
  sampleCtx,
}: {
  template: string;
  bankDetails: string;
  instruction: string;
  whatsappEnabled: boolean;
  sampleCtx: Record<string, string>;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState(initialTemplate);
  const [bankDetails, setBankDetails] = useState(initialBank);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [whatsappEnabled, setWhatsappEnabled] = useState(initialWa);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Live preview — pure client-side render with the edited bank/instruction merged in.
  const preview = useMemo(
    () => renderTemplate(template, { ...sampleCtx, bank_details: bankDetails, instruction }),
    [template, bankDetails, instruction, sampleCtx],
  );

  function save() {
    setBanner(null);
    start(async () => {
      const res = await setTemplateAction({ template, bankDetails, instruction, whatsappEnabled });
      if (res?.serverError) return setBanner(res.serverError);
      setBanner("Saved. New drafts will use this template immediately.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {banner && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{banner}</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm font-medium">Template body</label>
          <textarea className={`${input} h-80`} value={template} onChange={(e) => setTemplate(e.target.value)} />
          <label className="block text-sm font-medium">Company bank / payment details</label>
          <textarea className={`${input} h-28`} value={bankDetails} onChange={(e) => setBankDetails(e.target.value)} />
          <label className="block text-sm font-medium">Screenshot / Txn ID instruction</label>
          <textarea className={`${input} h-20`} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={whatsappEnabled} onChange={(e) => setWhatsappEnabled(e.target.checked)} />
            Enable WhatsApp send link on drafts (Q-01)
          </label>
          <button
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            disabled={pending}
            onClick={save}
          >
            {pending ? "Saving…" : "Save template"}
          </button>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Live preview (sample data)</div>
          <pre className="h-[34rem] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
            {preview}
          </pre>
        </div>
      </div>
    </div>
  );
}

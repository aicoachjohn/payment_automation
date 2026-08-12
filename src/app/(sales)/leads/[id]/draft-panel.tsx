"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { generateDraftAction, emailDraftAction } from "@/app/(sales)/leads/actions";

export interface DraftVersion {
  version: number;
  content: string;
  generatedAt: string;
  generatedByName: string;
}

const btn = "rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50";

export function DraftPanel({
  leadId,
  blockers,
  versions,
  whatsappEnabled,
  learnerMobile,
}: {
  leadId: string;
  blockers: string[];
  versions: DraftVersion[];
  whatsappEnabled: boolean;
  learnerMobile: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [banner, setBanner] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewVersion, setViewVersion] = useState(versions[0]?.version ?? null);

  const current = versions.find((v) => v.version === viewVersion) ?? versions[0] ?? null;
  const canGenerate = blockers.length === 0;

  function generate() {
    setBanner(null);
    start(async () => {
      const res = await generateDraftAction({ leadId });
      if (res?.serverError) return setBanner(res.serverError);
      router.refresh();
    });
  }

  async function copy() {
    if (!current) return;
    await navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function email() {
    setBanner(null);
    start(async () => {
      const res = await emailDraftAction({ leadId });
      if (res?.serverError) return setBanner(res.serverError);
      setBanner("Draft emailed to the learner (dev: see server console).");
    });
  }

  const waLink =
    whatsappEnabled && current && learnerMobile
      ? `https://wa.me/${learnerMobile.replace(/\D/g, "")}?text=${encodeURIComponent(current.content)}`
      : null;

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-5 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payment draft</h2>
        {versions.length > 0 && <span className="text-xs text-slate-500">{versions.length} version(s)</span>}
      </div>

      {banner && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{banner}</p>}

      {!canGenerate && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Complete these before generating the draft: <strong>{blockers.join(", ")}</strong>.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className={`${btn} bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900`} disabled={pending || !canGenerate} onClick={generate}>
          {versions.length === 0 ? "Generate draft" : "Regenerate draft"}
        </button>
        {current && (
          <button className={`${btn} bg-emerald-600 px-6 text-base text-white hover:bg-emerald-700`} onClick={copy}>
            {copied ? "Copied ✓" : "Copy to clipboard"}
          </button>
        )}
        {current && (
          <a className={`${btn} border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800`} href={`/api/leads/${leadId}/draft?version=${current.version}`} target="_blank" rel="noreferrer">
            Download PDF
          </a>
        )}
        {current && (
          <button className={`${btn} border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800`} disabled={pending} onClick={email}>
            Send by email
          </button>
        )}
        {waLink && (
          <a className={`${btn} border border-green-300 text-green-700 hover:bg-green-50`} href={waLink} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
      </div>

      {current && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm dark:bg-slate-900">{current.content}</pre>
      )}

      {versions.length > 1 && (
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase text-slate-500">Version history</div>
          <ul className="text-sm">
            {versions.map((v) => (
              <li key={v.version}>
                <button className={`hover:underline ${v.version === viewVersion ? "font-semibold" : "text-slate-500"}`} onClick={() => setViewVersion(v.version)}>
                  v{v.version} — {formatDate(v.generatedAt)} by {v.generatedByName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

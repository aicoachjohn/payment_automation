"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setConfigAction } from "@/app/(superadmin)/admin/actions";

/** Edit a single SystemConfig value. Every change is audited server-side (FR-ADM-04). */
export function ConfigEditor({ configKey, current, description }: { configKey: string; current: string; description: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null); setSaved(false);
    start(async () => {
      const res = await setConfigAction({ key: configKey, value });
      if (res?.serverError) return setError(res.serverError);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <code className="text-sm font-semibold">{configKey}</code>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
      {description && <p className="mb-1 text-xs text-slate-500">{description}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
        />
        <button type="button" onClick={save} disabled={pending || value === current} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Add a new config key. */
export function AddConfig() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await setConfigAction({ key, value });
      if (res?.serverError) return setError(res.serverError);
      setKey(""); setValue("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
      <h3 className="mb-2 text-sm font-semibold">Add a configuration key</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" className="rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="value (JSON or text)" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
        <button type="button" onClick={save} disabled={pending || !key.trim()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">Add</button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

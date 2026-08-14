"use client";

import { useState, useTransition } from "react";
import { createIntakeInviteAction } from "@/app/(sales)/leads/actions";

/**
 * Dashboard action: mint a single-use, 7-day self-intake link and share it (copy / WhatsApp).
 * The prospective lead fills their own details on the public /intake/[token] page.
 */
export function ShareIntakeLinkButton() {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function create() {
    setError(null);
    start(async () => {
      const res = await createIntakeInviteAction({});
      if (res?.serverError) return setError(res.serverError);
      const data = res?.data;
      if (data?.ok) {
        setUrl(data.url);
        setExpiresAt(data.expiresAt);
      }
    });
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const waLink = url
    ? `https://wa.me/?text=${encodeURIComponent(`Please fill your ProITbridge enrollment details here (link expires in 7 days): ${url}`)}`
    : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "Creating…" : "Share a self-intake link"}
      </button>

      {(url || error) && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {url && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Send this to the lead — they fill their own details. It works <strong>once</strong> and expires{" "}
                {expiresAt ? new Date(expiresAt).toLocaleDateString() : "in 7 days"}.
              </p>
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-700"
                >
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
                {waLink && (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-green-300 px-3 py-1.5 text-xs text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400"
                  >
                    WhatsApp
                  </a>
                )}
                <button type="button" onClick={() => { setUrl(null); setError(null); }} className="ml-auto text-xs text-slate-400 hover:underline">
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

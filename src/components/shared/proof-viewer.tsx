"use client";

import { useState, useTransition } from "react";
import { requestProofUrlAction } from "@/app/(sales)/leads/payment-actions";

/**
 * Zoomable payment-proof preview (FR-SAL-46, FR-DM-03). Requests a short-lived signed
 * URL on demand (never a stored public link) and shows the image with click-to-zoom.
 * Reused by the Data Management (Phase 7) and Finance (Phase 8) dashboards.
 */
export function ProofViewer({ proofId, label = "View proof" }: { proofId: string; label?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    setError(null);
    start(async () => {
      const res = await requestProofUrlAction({ proofId });
      if (res?.serverError) return setError(res.serverError);
      if (res?.data?.url) setUrl(res.data.url);
    });
  }

  if (error) return <span className="text-xs text-red-600">{error}</span>;

  if (!url) {
    return (
      <button
        type="button"
        onClick={load}
        disabled={pending}
        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "Loading…" : label}
      </button>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Payment proof"
        onClick={() => setZoom(true)}
        className="max-h-40 cursor-zoom-in rounded border border-slate-200 dark:border-slate-800"
      />
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Payment proof (zoomed)" className="max-h-[90vh] max-w-[90vw] cursor-zoom-out rounded" />
        </div>
      )}
    </>
  );
}

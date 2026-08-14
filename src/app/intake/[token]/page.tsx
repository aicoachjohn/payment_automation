import { isIntakeTokenValid } from "@/server/services/lead-intake-link";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic"; // token validity is checked per request

/**
 * PUBLIC self-intake page (no login). A prospective learner opens the link a salesperson
 * shared and fills their own details. An invalid / used / expired token shows a generic
 * message — no record data is ever rendered.
 */
export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await isIntakeTokenValid(token);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-navy px-4 py-10">
      <div className="pointer-events-none absolute -right-40 top-10 h-96 w-96 rounded-full bg-brand-blue/20 blur-3xl" />
      <div className="pointer-events-none absolute -left-32 bottom-0 h-80 w-80 rounded-full bg-brand-blue/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,176,240,0.10),transparent_55%)]" />

      <div className="relative w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="rounded-2xl bg-white px-6 py-3.5 shadow-xl shadow-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proitbridge-logo-mark.png" alt="ProITbridge" className="h-9 w-auto" />
          </div>
          <p className="text-sm font-medium text-slate-300">Enrollment details</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl dark:bg-slate-900">
          {valid ? (
            <IntakeForm token={token} />
          ) : (
            <div className="space-y-2 text-center">
              <h1 className="text-lg font-semibold text-brand-navy dark:text-slate-100">This link has expired</h1>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                This enrollment link is invalid or has already been used. Please contact your ProITbridge
                advisor for a fresh link.
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs uppercase tracking-[0.2em] text-slate-400">Strive For Better Future</p>
      </div>
    </div>
  );
}

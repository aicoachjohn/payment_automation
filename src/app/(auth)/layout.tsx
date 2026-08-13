export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-navy px-4 py-10">
      {/* Brand glow accents echoing the corporate hero */}
      <div className="pointer-events-none absolute -right-40 top-10 h-96 w-96 rounded-full bg-brand-blue/20 blur-3xl" />
      <div className="pointer-events-none absolute -left-32 bottom-0 h-80 w-80 rounded-full bg-brand-blue/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,176,240,0.10),transparent_55%)]" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="rounded-2xl bg-white px-6 py-3.5 shadow-xl shadow-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proitbridge-logo-mark.png" alt="ProITbridge" className="h-9 w-auto" />
          </div>
          <p className="text-sm font-medium text-slate-300">Payment &amp; Enrollment Automation</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl dark:bg-slate-900">
          {children}
        </div>

        <p className="mt-6 text-center text-xs uppercase tracking-[0.2em] text-slate-400">
          Strive For Better Future
        </p>
      </div>
    </div>
  );
}

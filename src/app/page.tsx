/**
 * Placeholder home route (Phase 0).
 *
 * No business feature or dashboard is built in this phase. Later phases add
 * role routing on login: SALESPERSON/SALES_MANAGER → /sales,
 * DATA_MGMT_AUDITOR → /audit, FINANCE_REVIEWER → /finance, SUPER_ADMIN → /admin.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <p className="font-mono text-xs uppercase tracking-widest text-slate-500">
        ProITbridge · Phase 0
      </p>
      <h1 className="text-2xl font-semibold sm:text-3xl">
        Payment &amp; Enrollment Automation Platform
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        Foundation is in place. Sales → Data Management (L1 audit) → Finance.
        Business features are delivered in Phases 1&ndash;12 &mdash; see{" "}
        <code className="font-mono text-sm">CLAUDE.md</code> and{" "}
        <code className="font-mono text-sm">docs/REQUIREMENTS_INDEX.md</code>.
      </p>
    </main>
  );
}

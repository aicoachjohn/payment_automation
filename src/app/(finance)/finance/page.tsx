import Link from "next/link";
import { Role, PaymentType, Program, Plan } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { financeOverview, financeStatement, listSalespeople, type StatementFilters } from "@/server/services/finance";
import { STATEMENT_COLUMNS } from "@/lib/finance-columns";
import { formatINR } from "@/lib/format";
import { ProofViewer } from "@/components/shared/proof-viewer";

export const dynamic = "force-dynamic";

function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export default async function FinanceStatementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user, actor } = await requireRoles([Role.FINANCE_REVIEWER]);
  const sp = await searchParams;
  const today = todayIso();
  const filters: StatementFilters = {
    from: sp.from || today,
    to: sp.to || today,
    paymentType: (sp.paymentType as PaymentType) || undefined,
    typeGroup: (sp.typeGroup as "holding" | "followup") || undefined,
    program: (sp.program as Program) || undefined,
    plan: (sp.plan as Plan) || undefined,
    salespersonId: sp.salespersonId || undefined,
    search: sp.search || undefined,
  };

  const [tiles, statement, salespeople] = await Promise.all([
    financeOverview(actor),
    financeStatement(actor, filters),
    listSalespeople(actor),
  ]);

  const exportQuery = new URLSearchParams(
    Object.entries({ report: "statement", ...filters }).filter(([, v]) => v) as [string, string][],
  );
  const csvHref = `/api/finance/export?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "csv" })}`;
  const pdfHref = `/api/finance/export?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "pdf" })}`;
  const approvedToday = tiles.find((t) => t.key === "approvedToday");

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Finance Dashboard</h1>
        <p className="text-sm text-slate-500">
          Welcome, {user.name}. This dashboard is <strong>read-only by design</strong> (BR-18) and shows only
          Nandhiya-approved payments. Every total is computed from those approved records.
        </p>
      </div>

      {approvedToday && approvedToday.count > 0 && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <strong>{approvedToday.count}</strong> payment{approvedToday.count === 1 ? "" : "s"} approved today
          {approvedToday.value ? ` — ${formatINR(approvedToday.value)}` : ""}. They appear below automatically, with
          no manual forwarding step.
        </div>
      )}

      {/* Overview tiles (FRD 7.4) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.key}
            className={`rounded-lg border p-4 ${
              t.key === "awaitingAudit"
                ? "border-dashed border-slate-300 dark:border-slate-700"
                : "border-slate-200 dark:border-slate-800"
            }`}
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold">{t.value ? formatINR(t.value) : t.count}</div>
            <div className="text-xs text-slate-500">
              {t.value ? `${t.count} record${t.count === 1 ? "" : "s"}` : t.note ?? ""}
              {t.value && t.note ? ` · ${t.note}` : ""}
            </div>
          </div>
        ))}
      </div>

      {/* Filters (FR-FIN-02) */}
      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label className="flex flex-col gap-1 text-xs text-slate-500">From
          <input type="date" name="from" defaultValue={filters.from} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">To
          <input type="date" name="to" defaultValue={filters.to} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Payment type
          <select name="paymentType" defaultValue={sp.paymentType ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.values(PaymentType).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">View
          <select name="typeGroup" defaultValue={sp.typeGroup ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">Combined</option>
            <option value="holding">Course Holding</option>
            <option value="followup">Follow-up</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Program
          <select name="program" defaultValue={sp.program ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.values(Program).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Salesperson
          <select name="salespersonId" defaultValue={sp.salespersonId ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Search
          <input name="search" defaultValue={sp.search ?? ""} placeholder="Name, mobile, email, Txn ID" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Apply</button>
        <Link href="/finance" className="text-sm text-slate-500 hover:underline">Clear</Link>
        <div className="ml-auto flex gap-2">
          <a href={csvHref} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Export CSV</a>
          <a href={pdfHref} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Export PDF</a>
        </div>
      </form>

      {/* Period totals (FR-FIN-05) */}
      <div className="flex flex-wrap gap-6 text-sm">
        <div><span className="text-slate-500">Records:</span> <strong>{statement.count}</strong></div>
        <div><span className="text-slate-500">Period total received:</span> <strong>{formatINR(statement.total)}</strong></div>
      </div>

      {/* Statement table (FR-FIN-03) */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              {STATEMENT_COLUMNS.map((c) => <th key={c.header} className="whitespace-nowrap px-3 py-2">{c.header}</th>)}
              <th className="px-3 py-2">Proof</th>
              <th className="px-3 py-2">History</th>
            </tr>
          </thead>
          <tbody>
            {statement.rows.length === 0 && (
              <tr><td colSpan={STATEMENT_COLUMNS.length + 2} className="px-3 py-6 text-center text-slate-500">No approved payments for this selection.</td></tr>
            )}
            {statement.rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                {STATEMENT_COLUMNS.map((c) => (
                  <td key={c.header} className="whitespace-nowrap px-3 py-2">
                    {c.header === "Learner Name" ? (
                      <span className="flex items-center gap-1">
                        {c.get(r)}
                        {r.specialMarker && (
                          <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">{r.specialMarker}</span>
                        )}
                      </span>
                    ) : (
                      c.get(r)
                    )}
                  </td>
                ))}
                <td className="px-3 py-2">{r.proofId ? <ProofViewer proofId={r.proofId} /> : <span className="text-xs text-slate-400">—</span>}</td>
                <td className="px-3 py-2">
                  <Link href={`/finance/payments/${r.id}`} className="text-xs text-sky-600 hover:underline">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

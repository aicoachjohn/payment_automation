import Link from "next/link";
import { Role, Program, Plan } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { customerMaster, listSalespeople, type CustomerFilters } from "@/server/services/finance";
import { CustomerMasterClient } from "./customer-master-client";

export const dynamic = "force-dynamic";

export default async function FinanceCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireRoles([Role.FINANCE_REVIEWER]);
  const sp = await searchParams;
  const filters: CustomerFilters = {
    search: sp.search || undefined,
    program: (sp.program as Program) || undefined,
    plan: (sp.plan as Plan) || undefined,
    salespersonId: sp.salespersonId || undefined,
    paymentStatus: (sp.paymentStatus as CustomerFilters["paymentStatus"]) || undefined,
    enrollmentStatus: sp.enrollmentStatus || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  };
  const [rows, salespeople] = await Promise.all([customerMaster(actor, filters), listSalespeople(actor)]);

  const exportQuery = new URLSearchParams(
    Object.entries({ report: "customers", ...filters }).filter(([, v]) => v) as [string, string][],
  );
  const csvHref = `/api/finance/export?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "csv" })}`;
  const pdfHref = `/api/finance/export?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "pdf" })}`;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Customer Master</h1>
        <p className="text-sm text-slate-500">
          Maintained automatically from the sales record (BR-02) — no message required. Only customers with an
          approved payment appear here.
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Search
          <input name="search" defaultValue={sp.search ?? ""} placeholder="Name, mobile, email, Txn ID" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Program
          <select name="program" defaultValue={sp.program ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.values(Program).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Plan
          <select name="plan" defaultValue={sp.plan ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.values(Plan).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Salesperson
          <select name="salespersonId" defaultValue={sp.salespersonId ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Payment status
          <select name="paymentStatus" defaultValue={sp.paymentStatus ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            <option value="FULLY_PAID">Fully paid</option>
            <option value="PARTIAL">Partial</option>
            <option value="UNPAID">Unpaid</option>
          </select>
        </label>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Apply</button>
        <Link href="/finance/customers" className="text-sm text-slate-500 hover:underline">Clear</Link>
        <div className="ml-auto flex gap-2">
          <a href={csvHref} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Export CSV</a>
          <a href={pdfHref} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Export PDF</a>
        </div>
      </form>

      <CustomerMasterClient rows={rows} />
    </section>
  );
}

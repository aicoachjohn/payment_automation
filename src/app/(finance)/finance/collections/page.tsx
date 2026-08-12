import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import {
  monthlyCollectionSummary,
  gstSummary,
  outstandingReport,
  collectionTrend,
} from "@/server/services/finance";
import { getFinanceDigestPrefs } from "@/server/services/finance-digest";
import { formatINR, formatDate } from "@/lib/format";
import { BarChart, type BarDatum } from "@/components/shared/bar-chart";
import { DigestForm } from "./digest-form";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function FinanceCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireRoles([Role.FINANCE_REVIEWER]);
  const sp = await searchParams;
  const now = new Date();
  const year = sp.year ? Number(sp.year) : now.getUTCFullYear();
  const month = sp.month ? Number(sp.month) : now.getUTCMonth() + 1;

  const [summary, gst, outstanding, trend, digest] = await Promise.all([
    monthlyCollectionSummary(actor, year, month),
    gstSummary(actor, year, month),
    outstandingReport(actor),
    collectionTrend(actor, 6, now),
    getFinanceDigestPrefs(actor),
  ]);

  const trendData: BarDatum[] = trend.trend.map((p) => ({ label: p.label.split(" ")[0], value: Number(p.value), display: formatINR(p.value) }));
  const mixData: BarDatum[] = trend.typeMix.map((m) => ({ label: m.label.split(" ")[0], value: Number(m.value), display: formatINR(m.value) }));

  const exp = (report: string, format: string) =>
    `/api/finance/export?${new URLSearchParams({ report, format, year: String(year), month: String(month) })}`;

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Collections & Reports</h1>
        <p className="text-sm text-slate-500">
          Every figure derives solely from Nandhiya-approved records — viewable with zero interaction with the sales
          team (FR-FIN-21).
        </p>
      </div>

      {/* Month selector */}
      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Month
          <select name="month" defaultValue={month} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Year
          <input name="year" type="number" defaultValue={year} className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">View</button>
      </form>

      {/* Monthly collection summary (FR-FIN-20) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Monthly Collection Summary — {MONTHS[month - 1]} {year}</h2>
          <div className="flex gap-2">
            <a href={exp("monthly", "csv")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">CSV</a>
            <a href={exp("monthly", "pdf")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">PDF</a>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total approved collection</div>
          <div className="text-3xl font-semibold">{formatINR(summary.total)}</div>
          <div className="text-xs text-slate-500">{summary.count} payment{summary.count === 1 ? "" : "s"}</div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SplitTable title="By payment type" rows={summary.byType.map((t) => ({ label: t.label, value: t.value, count: t.count }))} />
          <SplitTable title="By salesperson" rows={summary.bySalesperson.map((t) => ({ label: t.name, value: t.value, count: t.count }))} />
          <SplitTable title="By program" rows={summary.byProgram.map((t) => ({ label: t.key, value: t.value, count: t.count }))} />
          <SplitTable title="By plan" rows={summary.byPlan.map((t) => ({ label: t.key, value: t.value, count: t.count }))} />
        </div>
      </div>

      {/* GST summary (FR-FIN-24) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">GST Summary — {MONTHS[month - 1]} {year}</h2>
          <div className="flex gap-2">
            <a href={exp("gst", "csv")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">CSV</a>
            <a href={exp("gst", "pdf")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">PDF</a>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Base value">{formatINR(gst.base)}</Stat>
          <Stat label="GST component">{formatINR(gst.gst)}</Stat>
          <Stat label="Total collection">{formatINR(gst.total)}</Stat>
        </div>
        <p className="text-xs text-slate-500">Base + GST reconciles exactly to the total collection ({formatINR(gst.base)} + {formatINR(gst.gst)} = {formatINR(gst.total)}).</p>
      </div>

      {/* Trend + payment-type mix (FR-FIN-23) */}
      <div className="grid gap-6 md:grid-cols-2">
        <BarChart title="Collection — last 6 months" data={trendData} />
        <BarChart title="Payment-type mix (period)" data={mixData} />
      </div>

      {/* Outstanding report (FR-FIN-22) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Outstanding Balances</h2>
          <div className="flex gap-2">
            <a href={exp("outstanding", "csv")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">CSV</a>
            <a href={exp("outstanding", "pdf")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">PDF</a>
          </div>
        </div>
        <p className="text-sm text-slate-500">Total outstanding: <strong>{formatINR(outstanding.total)}</strong> across {outstanding.rows.length} learner{outstanding.rows.length === 1 ? "" : "s"}.</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2">Learner</th>
                <th className="px-3 py-2">Program</th>
                <th className="px-3 py-2">Outstanding</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Days</th>
                <th className="px-3 py-2">Salesperson</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No outstanding balances.</td></tr>
              )}
              {outstanding.rows.map((r) => (
                <tr key={r.enrollmentId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{r.learnerName}</td>
                  <td className="px-3 py-2">{r.program}</td>
                  <td className="px-3 py-2 font-medium">{formatINR(r.outstanding)}</td>
                  <td className="px-3 py-2">{r.paymentStage}</td>
                  <td className="px-3 py-2">{r.daysOutstanding}</td>
                  <td className="px-3 py-2">{r.salesperson}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DigestForm initial={digest} />
      <p className="text-xs text-slate-400">Trend as of {formatDate(now.toISOString())}.</p>
    </section>
  );
}

function SplitTable({ title, rows }: { title: string; rows: { label: string; value: string; count: number }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <table className="min-w-full text-sm">
        <tbody>
          {rows.filter((r) => r.count > 0).length === 0 && (
            <tr><td className="py-1 text-slate-500">No collection this month.</td></tr>
          )}
          {rows.filter((r) => r.count > 0).map((r) => (
            <tr key={r.label} className="border-t border-slate-100 first:border-0 dark:border-slate-800">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right font-medium">{formatINR(r.value)}</td>
              <td className="py-1.5 pl-3 text-right text-xs text-slate-500">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{children}</div>
    </div>
  );
}

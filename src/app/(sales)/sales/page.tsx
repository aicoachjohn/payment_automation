import Link from "next/link";
import { Role, LeadStatus, Program, Plan } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { dashboardSummary, listLeads } from "@/server/services/leads";
import { downPaymentCountdowns } from "@/server/services/automation";
import { myPendingActions } from "@/server/services/follow-ups";
import { formatINR, formatDate } from "@/lib/format";
import { APPROVAL_LABEL, type ApprovalState } from "@/server/services/lead-status";
import { ShareIntakeLinkButton } from "./share-intake-link";

const STATUS_LABEL: Record<string, string> = {
  NEW_LEAD: "New", INTERESTED: "Interested", BASIC_DETAILS_PENDING: "Details pending",
  BASIC_DETAILS_RECEIVED: "Details received", PAYMENT_DRAFT_GENERATED: "Draft generated",
  PAYMENT_PENDING: "Payment pending", HOLDING_OR_STARTING_RECEIVED: "Holding received",
  DOWN_PAYMENT_PENDING: "Down payment pending", DOWN_PAYMENT_RECEIVED: "Down payment received",
  FINAL_PAYMENT_PENDING: "Final payment pending", FULLY_PAID: "Fully paid",
  ENROLLMENT_COMPLETED: "Completed", OPERATIONS_HANDOVER: "Handover",
};

function Tile({ label, value, href, accent }: { label: string; value: string | number; href: string; accent?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg border p-4 transition hover:shadow-sm ${accent ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" : "border-slate-200 dark:border-slate-800"}`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Link>
  );
}

export default async function SalesHome({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; program?: string; plan?: string; search?: string; salespersonId?: string }>;
}) {
  const { user, actor } = await requireRoles([Role.SALESPERSON, Role.SALES_MANAGER]);
  const sp = await searchParams;
  const filters = {
    status: sp.status as LeadStatus | undefined,
    program: sp.program as Program | undefined,
    plan: sp.plan as Plan | undefined,
    search: sp.search || undefined,
    salespersonId: sp.salespersonId || undefined,
  };

  const [summary, leads, countdowns, pending] = await Promise.all([
    dashboardSummary(actor, filters),
    listLeads(actor, filters),
    downPaymentCountdowns(actor),
    myPendingActions(actor),
  ]);
  const isManager = user.role === Role.SALES_MANAGER;

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sales Dashboard</h1>
          <p className="text-sm text-slate-500">
            {isManager ? "All leads across the team." : "Your leads."} Welcome, {user.name}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/leads/intake" className="inline-flex min-h-[44px] items-center sm:min-h-0 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy-700">
            Enrollment from uploads
          </Link>
          <Link href="/leads/new" className="inline-flex min-h-[44px] items-center sm:min-h-0 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
            + New lead
          </Link>
          <ShareIntakeLinkButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total Leads" value={summary.totalLeads} href="/sales" />
        <Tile label="Basic Details Pending" value={summary.basicDetailsPending} href="/sales?status=BASIC_DETAILS_PENDING" />
        <Tile label="Payment Pending" value={summary.paymentPending} href="/sales?status=PAYMENT_PENDING" />
        <Tile label="Down Payment Pending" value={summary.downPaymentPending} href="/sales?status=DOWN_PAYMENT_PENDING" />
        <Tile label="15-Day Deadline" value={summary.fifteenDayApproaching} href="/sales?status=DOWN_PAYMENT_PENDING" accent={summary.fifteenDayApproaching > 0} />
        <Tile label="Fully Paid" value={summary.fullyPaid} href="/sales?status=FULLY_PAID" />
        <Tile label="Corrections Required" value={summary.correctionsRequired} href="/sales" accent={summary.correctionsRequired > 0} />
        <Tile label="Collected (this month)" value={formatINR(summary.totalCollectedThisMonth)} href="/sales" />
      </div>

      {(countdowns.length > 0 || pending.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* 15-day down-payment countdowns (FR-SAL-50) */}
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <h2 className="mb-2 text-sm font-semibold">Down-payment deadlines</h2>
            {countdowns.length === 0 ? (
              <p className="text-sm text-slate-500">None active.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {countdowns.map((c) => (
                  <li key={c.leadId} className="flex items-center justify-between gap-2">
                    <Link href={`/leads/${c.leadId}`} className="hover:underline">{c.learnerName}</Link>
                    <span className={c.overdue ? "text-red-600" : c.daysRemaining <= 2 ? "text-amber-600" : "text-slate-500"}>
                      {c.overdue ? "Overdue" : `${c.daysRemaining} day(s) left`} · {formatDate(c.deadline)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* My Pending Actions (FR-SAL-66) */}
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <h2 className="mb-2 text-sm font-semibold">My pending actions</h2>
            {pending.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing due.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {pending.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <Link href={`/leads/${t.leadId}`} className="hover:underline">{t.learnerName}: {t.description}</Link>
                    <span className={t.overdue ? "text-red-600" : "text-slate-500"}>{formatDate(t.dueDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Search
          <input name="search" defaultValue={sp.search ?? ""} placeholder="Name, mobile, email" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Status
          <select name="status" defaultValue={sp.status ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Program
          <select name="program" defaultValue={sp.program ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <option value="">All</option>
            {Object.values(Program).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Filter</button>
        <Link href="/sales" className="inline-flex min-h-[44px] items-center text-sm text-slate-500 hover:underline sm:min-h-0">Clear</Link>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2">Name</th>
              {isManager && <th className="px-3 py-2">Owner</th>}
              <th className="px-3 py-2">Mobile</th>
              <th className="px-3 py-2">Program / Plan</th>
              <th className="px-3 py-2">Final Fee</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Approval</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td colSpan={isManager ? 8 : 7} className="px-3 py-6 text-center text-slate-400">No leads yet.</td></tr>
            )}
            {leads.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
                <td className="px-3 py-2">
                  <Link href={`/leads/${l.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">{l.fullName}</Link>
                  {l.concessionStatus === "PENDING_APPROVAL" && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-800">concession pending</span>}
                </td>
                {isManager && <td className="px-3 py-2 text-slate-500">{l.ownerName}</td>}
                <td className="px-3 py-2 text-slate-500">{l.mobile ?? "—"}</td>
                <td className="px-3 py-2">{l.program ?? "—"}{l.plan ? ` / ${l.plan}` : ""}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.finalApprovedFee ? formatINR(l.finalApprovedFee) : "—"}</td>
                <td className="px-3 py-2">{STATUS_LABEL[l.status] ?? l.status}</td>
                <td className="px-3 py-2"><ApprovalChip state={l.approval} /></td>
                <td className="px-3 py-2 text-xs text-slate-500">{formatDate(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Where the lead stands in the approval chain, colour-coded by who owes the next move:
 * red = Sales must act, amber = waiting on someone else, green = done.
 */
const APPROVAL_TONE: Record<ApprovalState, string> = {
  NOT_SUBMITTED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  CORRECTION_REQUIRED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  PAYMENT_REJECTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  RETURNED_BY_FINANCE: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  AWAITING_AUDIT: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  WITH_DATA_MGMT: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  APPROVED_BY_DATA_MGMT: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  APPROVED_BY_FINANCE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

function ApprovalChip({ state }: { state: ApprovalState }) {
  return (
    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${APPROVAL_TONE[state]}`}>
      {APPROVAL_LABEL[state]}
    </span>
  );
}

import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { systemOverview, workflowHealth } from "@/server/services/admin-console";
import { formatINR } from "@/lib/format";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  NEW_LEAD: "New", INTERESTED: "Interested", BASIC_DETAILS_PENDING: "Basic pending",
  BASIC_DETAILS_RECEIVED: "Basic received", PAYMENT_DRAFT_GENERATED: "Draft", PAYMENT_PENDING: "Payment pending",
  HOLDING_OR_STARTING_RECEIVED: "Holding/Starting", DOWN_PAYMENT_PENDING: "Down pending",
  DOWN_PAYMENT_RECEIVED: "Down received", FINAL_PAYMENT_PENDING: "Final pending", FULLY_PAID: "Fully paid",
  ENROLLMENT_COMPLETED: "Completed", OPERATIONS_HANDOVER: "Ops handover",
};

export default async function AdminHome() {
  const { user, actor } = await requireRoles([Role.SUPER_ADMIN]);
  const [overview, health] = await Promise.all([systemOverview(actor), workflowHealth(actor)]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Super Admin Console</h1>
        <p className="text-sm text-slate-500">
          Welcome, {user.name}. You can unblock any situation — but never quietly change a number. Every override is
          reasoned, logged and reported to Rajesh.
        </p>
      </div>

      {/* Consolidated overview (FR-SA-02) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total leads" value={String(overview.totalLeads)} />
        <Tile label="Pending audit" value={String(overview.pendingAudit)} note={`${overview.pendingAuditAmber} ageing · ${overview.pendingAuditRed} overdue`} />
        <Tile label="Approved collection (month)" value={formatINR(overview.approvedCollectionThisMonth)} />
        <Tile label="Total outstanding" value={formatINR(overview.outstandingTotal)} />
        <Tile label="15-day deadlines" value={String(overview.fifteenDayApproaching)} note="approaching" />
        <Tile label="Ops handovers done" value={String(overview.opsHandoversCompleted)} />
      </div>

      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-2 text-sm font-semibold">Lead stage distribution</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {overview.leadsByStage.map((s) => (
            <span key={s.status} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
              {STAGE_LABEL[s.status] ?? s.status}: <strong>{s.count}</strong>
            </span>
          ))}
        </div>
      </div>

      {/* Workflow health (FR-SA-04) */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Workflow health</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <HealthCard title="Aged pending audit" alert={health.agedPendingAudit.count > 0}>
            {health.agedPendingAudit.count} record(s) pending beyond {health.agedPendingAudit.thresholdHours}h.
          </HealthCard>
          <HealthCard title="Stalled leads" alert={health.stalledLeads.count > 0}>
            {health.stalledLeads.count} lead(s) unchanged for over {health.stalledLeads.stallDays} days.
          </HealthCard>
          <HealthCard title="Failed notifications" alert={health.failedNotifications > 0}>
            {health.failedNotifications} delivery failure(s).
          </HealthCard>
          <HealthCard title="Repeated corrections" alert={health.repeatedCorrections.length > 0}>
            {health.repeatedCorrections.length === 0
              ? "No salesperson with repeated correction outcomes."
              : health.repeatedCorrections.map((r) => `${r.salesperson} (${r.count})`).join(", ")}
          </HealthCard>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/admin/overrides" className="inline-flex min-h-[44px] items-center sm:min-h-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900">Override tools →</Link>
        <Link href="/admin/audit" className="inline-flex min-h-[44px] items-center sm:min-h-0 rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Audit trail →</Link>
        <Link href="/admin/activity" className="inline-flex min-h-[44px] items-center sm:min-h-0 rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">My activity log →</Link>
      </div>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </div>
  );
}

function HealthCard({ title, alert, children }: { title: string; alert: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-4 ${alert ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" : "border-slate-200 dark:border-slate-800"}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{children}</div>
    </div>
  );
}

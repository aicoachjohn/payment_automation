import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/guard";
import { AppShell } from "@/components/shared/app-shell";
import { ROLE_HOME } from "@/server/auth/permissions";
import { Role } from "@prisma/client";
import { getHandover, buildHandoverSnapshot, HandoverError } from "@/server/services/handover";
import { PassToFinance } from "../pass-to-finance";
import { FinanceDecision } from "../finance-decision";
import { formatINR, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, actor } = await requireAuth();
  const { id } = await params;
  let h;
  try {
    h = await getHandover(actor, id);
  } catch (e) {
    if (e instanceof HandoverError) notFound();
    throw e;
  }
  const r = h.record;

  // Nandhiya's onward step. Her blockers are computed live rather than read from the snapshot,
  // because she will have been approving payments since Sales assembled it.
  const isAuditor = user.role === Role.DATA_MGMT_AUDITOR;
  const isFinance = user.role === Role.FINANCE_REVIEWER;
  const withDataMgmt = h.stage === "WITH_DATA_MGMT";
  const withFinance = h.stage === "WITH_FINANCE";
  const blockers = isAuditor && withDataMgmt
    ? (await buildHandoverSnapshot(h.enrollmentId)).dataMgmtMissing
    : [];

  return (
    <AppShell user={user} nav={[{ href: ROLE_HOME[user.role], label: "Dashboard" }]}>
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Handover — {r.learner.fullName}</h1>
            <p className="text-sm text-slate-500">
              {withDataMgmt
                ? "With Data Management (Nandhiya)"
                : withFinance
                  ? "With Finance (Rajesh) — awaiting sign-off"
                  : "Approved by Finance"}
              {h.handoverDate ? ` · handed over ${formatDate(h.handoverDate)}` : ""}
            </p>
          </div>
          <a href={`/api/handover/${h.id}/pdf`} className="inline-flex min-h-[44px] items-center sm:min-h-0 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Export PDF</a>
        </div>

        {/* Server-rendered so the confirmation SURVIVES the refresh. The decision panel
            unmounts the moment the stage changes, so without this Rajesh would click
            Approve and be shown nothing at all. */}
        {/* Same reason as the Finance banner below: the "Pass to Finance" panel unmounts the
            instant the stage moves, taking its own success message with it, so Nandhiya was
            left with no confirmation that her hand-off worked. */}
        {withFinance && (
          <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
            <strong>Handed over to Rajesh (Finance).</strong> Waiting on his sign-off.
          </div>
        )}

        {h.stage === "FINANCE_APPROVED" && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <strong>Approved by Finance.</strong> This learner is signed off
            {h.financeDecisionAt ? ` on ${formatDate(h.financeDecisionAt)}` : ""}.
          </div>
        )}

        {/* Finance sent it back — Nandhiya needs to see why before she can act on it. */}
        {h.financeRejectionReason && withDataMgmt && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            <strong>Finance sent this back.</strong> {h.financeRejectionReason}
          </div>
        )}

        {isAuditor && withDataMgmt && <PassToFinance handoverId={h.id} blockers={blockers} />}
        {isFinance && withFinance && <FinanceDecision handoverId={h.id} />}

        {h.missing.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Incomplete at handover: {h.missing.join("; ")}.
          </div>
        )}

        <Card title="Learner">
          <Row k="Full name" v={r.learner.fullName} />
          <Row k="Date of birth" v={r.learner.dob ? formatDate(r.learner.dob) : "—"} />
          <Row k="Address" v={r.learner.address ?? "—"} />
          <Row k="Email" v={r.learner.email ?? "—"} />
          <Row k="Mobile" v={r.learner.mobile ?? "—"} />
        </Card>
        <Card title="Course">
          <Row k="Program" v={r.course.program} />
          <Row k="Plan" v={r.course.plan} />
          <Row k="Combo mode" v={r.course.comboMode ?? "—"} />
          <Row k="Commencing date" v={r.course.commencingDate ? formatDate(r.course.commencingDate) : "—"} />
          <Row k="Batch" v={r.course.batch ?? "—"} />
        </Card>
        <Card title="Pricing">
          <Row k="Standard fee" v={r.pricing.standardFee ? formatINR(r.pricing.standardFee) : "—"} />
          <Row k="Concession" v={formatINR(r.pricing.concession)} />
          <Row k="Final approved fee" v={r.pricing.finalApprovedFee ? formatINR(r.pricing.finalApprovedFee) : "—"} />
        </Card>
        <Card title="Payments">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-1 pr-4">#</th><th className="py-1 pr-4">Type</th><th className="py-1 pr-4">Received</th><th className="py-1 pr-4">Date</th><th className="py-1 pr-4">Txn ID</th><th className="py-1 pr-4">Proof</th><th className="py-1 pr-4">Status</th></tr>
              </thead>
              <tbody>
                {r.payments.map((p) => (
                  <tr key={p.number}><td className="py-1 pr-4">{p.number}</td><td className="py-1 pr-4">{p.type}</td><td className="py-1 pr-4">{formatINR(p.received)}</td><td className="py-1 pr-4">{formatDate(p.date)}</td><td className="py-1 pr-4">{p.transactionId}</td><td className="py-1 pr-4">{p.hasProof ? "Yes" : "No"}</td><td className="py-1 pr-4">{p.auditStatus}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-sm"><strong>Total received:</strong> {formatINR(r.totals.totalReceived)} · <strong>Balance:</strong> {formatINR(r.totals.balance)}</div>
        </Card>
        <Card title="Sales">
          <Row k="Salesperson" v={r.sales.salesperson} />
          <Row k="Lead source" v={r.sales.leadSource ?? "—"} />
          <Row k="Enrollment date" v={formatDate(r.sales.enrollmentDate)} />
          <Row k="Remarks" v={r.sales.remarks ?? "—"} />
        </Card>
      </section>
    </AppShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-40 shrink-0 text-slate-500">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

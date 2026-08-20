/**
 * Keeping the Google Sheet mirror in step with the database.
 *
 * `enqueueLeadSync` runs INSIDE the caller's transaction, so a lead and its sync intent
 * commit or fail together — but the sheet itself is written later, out of band. That split is
 * the whole point: Google being slow or down must never fail a salesperson's save, and a
 * network call has no business inside a database transaction holding row locks.
 *
 * `drainSheetSync` does the writing, and is safe to run on a timer or by hand.
 */
import "server-only";
import { AuditStatus } from "@prisma/client";
import { db, type DbTx } from "@/server/db";
import { calculateBalance, round, sum } from "@/server/money";
import { computeApprovalState, APPROVAL_LABEL } from "@/server/services/lead-status";
import { getSheetsProvider, sheetsMirrorEnabled } from "@/server/sheets";
import { buildLeadRow, type SheetLead } from "@/server/sheets/rows";

/** Queue a lead for mirroring. Cheap, and a no-op when the mirror is switched off. */
export async function enqueueLeadSync(tx: DbTx, leadId: string, reason: string): Promise<void> {
  if (!sheetsMirrorEnabled()) return;
  await tx.sheetSyncOutbox.create({ data: { leadId, reason } });
}

export interface DrainResult {
  written: number;
  failed: number;
  skipped: boolean;
}

/**
 * Write every queued lead to the sheet, newest state wins.
 *
 * Coalesces by lead: a lead touched ten times since the last run is written once, from its
 * CURRENT state, and all ten queue rows are cleared. Without that a busy day would burn the
 * Sheets rate limit re-writing the same row.
 */
export async function drainSheetSync(limit = 500): Promise<DrainResult> {
  if (!sheetsMirrorEnabled()) return { written: 0, failed: 0, skipped: true };

  const pending = await db.sheetSyncOutbox.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (pending.length === 0) return { written: 0, failed: 0, skipped: false };

  const leadIds = [...new Set(pending.map((p) => p.leadId))];
  const rows = await buildRowsFor(leadIds);

  try {
    await getSheetsProvider().upsertLeadRows(rows);
    await db.sheetSyncOutbox.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: "SYNCED", syncedAt: new Date() },
    });
    return { written: rows.length, failed: 0, skipped: false };
  } catch (e) {
    // Leave them PENDING so the next run retries; record why, and count the attempt so a
    // permanently broken row can be spotted rather than retried silently for ever.
    const message = e instanceof Error ? e.message : "Unknown error";
    await db.sheetSyncOutbox.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { attempts: { increment: 1 }, lastError: message.slice(0, 500) },
    });
    return { written: 0, failed: pending.length, skipped: false };
  }
}

/** Current state of the given leads, shaped for the sheet. */
async function buildRowsFor(leadIds: string[]): Promise<string[][]> {
  const leads = await db.lead.findMany({
    where: { id: { in: leadIds } },
    include: {
      salesperson: { select: { name: true } },
      enrollment: {
        include: {
          payments: { where: { voided: false } },
          handovers: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const now = new Date();
  return leads.map((l) => {
    const e = l.enrollment;
    const payments = e?.payments ?? [];
    const approved = payments.filter((p) => p.auditStatus === AuditStatus.APPROVED);
    const handover = e?.handovers[0] ?? null;

    const sheetLead: SheetLead = {
      id: l.id,
      createdAt: l.createdAt,
      salespersonName: l.salesperson.name,
      fullName: l.fullName,
      mobile: l.mobile,
      email: l.email,
      dob: l.dob,
      addressParts: [l.doorNo, l.street, l.address],
      district: l.district,
      state: l.state,
      pincode: l.pincode,
      program: e?.program ?? l.interestedProgram ?? null,
      plan: e?.plan ?? l.interestedPlan ?? null,
      comboMode: e?.comboMode ?? null,
      commencingDate: e?.commencingDate ?? null,
      finalApprovedFee: e?.finalApprovedFee?.toFixed(2) ?? null,
      totalApproved: round(sum(approved.map((p) => p.receivedAmount.toString()))).toFixed(2),
      balance: e?.finalApprovedFee
        ? calculateBalance(
            e.finalApprovedFee,
            payments.map((p) => ({
              receivedAmount: p.receivedAmount.toString(),
              auditStatus: p.auditStatus,
              voided: p.voided,
            })),
          ).toFixed(2)
        : "0.00",
      paymentCount: payments.length,
      approvedCount: approved.length,
      leadStatus: l.status,
      approvalLabel:
        APPROVAL_LABEL[
          computeApprovalState({
            payments: payments.map((p) => ({ auditStatus: p.auditStatus, voided: p.voided })),
            handoverStage: handover?.stage ?? null,
            financeReturned: Boolean(handover?.financeRejectionReason),
          })
        ],
    };
    return buildLeadRow(sheetLead, now);
  });
}

/**
 * Queue EVERY live lead — the one-off backfill when the mirror is first switched on, and the
 * repair if the sheet is ever lost or replaced.
 */
export async function enqueueFullBackfill(): Promise<number> {
  const leads = await db.lead.findMany({ where: { voided: false }, select: { id: true } });
  if (leads.length === 0) return 0;
  await db.sheetSyncOutbox.createMany({
    data: leads.map((l) => ({ leadId: l.id, reason: "backfill" })),
  });
  return leads.length;
}

/** The most recent failure recorded by a drain — what the manual sync button reports. */
export async function lastSheetSyncError(): Promise<string | null> {
  const row = await db.sheetSyncOutbox.findFirst({
    where: { status: "PENDING", lastError: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { lastError: true },
  });
  return row?.lastError ?? null;
}

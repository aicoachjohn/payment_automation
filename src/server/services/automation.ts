/**
 * The automation engine (Phase 10, FR-SAL-49..66, BR-07..10). Manual chasing disappears:
 * deadlines enforce themselves. `runDailyAutomation(now)` is the single tick — pure of
 * wall-clock (it takes `now`), so it is fully time-travelable in tests. Every side effect
 * is funnelled through the idempotent job runner, so running the tick twice for the same
 * IST day sends exactly one of each reminder and performs at most one transfer.
 *
 * TIMEZONE: all deadline arithmetic is in IST (UTC+5:30). "End of Day 15" is 23:59:59.999
 * IST on the fifteenth day after the Course Starting Amount was APPROVED.
 */
import "server-only";
import { AuditStatus, LeadStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { notifyUser, sendEmail } from "@/server/notifications";
import { getConfigNumber, getConfigValue } from "@/server/services/system-config";
import { runOnce } from "@/server/jobs/runner";
import type { Actor } from "@/server/auth/permissions";
import { IST_OFFSET_MS, istDayStartUtc, istDateKey, daysSinceIst, downPaymentDeadline } from "@/lib/ist";

// Re-export the pure IST helpers so callers (and the integration tests) can reach them here.
export { IST_OFFSET_MS, istDayStartUtc, istDateKey, daysSinceIst, downPaymentDeadline };

const DAY_MS = 86_400_000;

/** The automation acts with system authority; its audit rows resolve to "System". */
const SYSTEM_ACTOR = { userId: "system", role: Role.SUPER_ADMIN } as const;

// ── Config ──────────────────────────────────────────────────────────────────

async function reminderDays(): Promise<number[]> {
  const raw = await getConfigValue("reminder_days");
  if (Array.isArray(raw) && raw.every((n) => typeof n === "number")) return raw as number[];
  return [3, 7, 10, 13, 14];
}

// ── Recipient helpers ─────────────────────────────────────────────────────────

async function usersInRoles(roles: Role[]): Promise<{ id: string; email: string }[]> {
  return db.user.findMany({ where: { role: { in: roles }, status: "ACTIVE" }, select: { id: true, email: true } });
}

// ── The tick ───────────────────────────────────────────────────────────────────

export interface AutomationSummary {
  remindersSent: number;
  approachingAlerts: number;
  transfers: number;
  staleNudges: number;
  followUpsDue: number;
  ageingEscalations: number;
}

export async function runDailyAutomation(now: Date = new Date()): Promise<AutomationSummary> {
  const summary: AutomationSummary = { remindersSent: 0, approachingAlerts: 0, transfers: 0, staleNudges: 0, followUpsDue: 0, ageingEscalations: 0 };
  await fifteenDayRule(now, summary);
  await staleTriggers(now, summary);
  await followUpDue(now, summary);
  await ageingEscalation(now, summary);
  return summary;
}

// ── The 15-day rule (FR-SAL-49..53) ─────────────────────────────────────────────

interface Candidate {
  enrollmentId: string;
  leadId: string;
  learnerName: string;
  learnerEmail: string | null;
  salespersonId: string;
  salespersonEmail: string;
  anchor: Date; // approval time of the Course Starting Amount
}

/**
 * Enrollments under the countdown: the course has STARTED (BR-08 — a not-started course
 * has no time-bound restriction whatsoever), payment #1 (the Course Starting Amount) is
 * APPROVED, and the Down Payment is still pending (lead status DOWN_PAYMENT_PENDING).
 */
async function candidates(): Promise<Candidate[]> {
  const rows = await db.enrollment.findMany({
    where: {
      courseStartedFlag: true,
      lead: { voided: false, status: LeadStatus.DOWN_PAYMENT_PENDING },
      payments: { some: { paymentNumber: 1, auditStatus: AuditStatus.APPROVED, voided: false } },
    },
    include: {
      lead: { include: { salesperson: { select: { id: true, email: true } } } },
      payments: { where: { paymentNumber: 1, auditStatus: AuditStatus.APPROVED, voided: false }, take: 1 },
    },
  });
  return rows
    .filter((e) => e.payments[0]?.auditedAt)
    .map((e) => ({
      enrollmentId: e.id,
      leadId: e.leadId,
      learnerName: e.lead.fullName,
      learnerEmail: e.lead.email,
      salespersonId: e.lead.salesperson.id,
      salespersonEmail: e.lead.salesperson.email,
      anchor: e.payments[0]!.auditedAt!,
    }));
}

async function fifteenDayRule(now: Date, summary: AutomationSummary): Promise<void> {
  const [days, windowDays, learnerRemind] = await Promise.all([
    reminderDays(),
    getConfigNumber("down_payment_window_days", 15),
    getConfigValue("learner_reminders_enabled"),
  ]);
  const managers = await usersInRoles([Role.SALES_MANAGER]);
  const list = await candidates();

  for (const c of list) {
    const n = daysSinceIst(c.anchor, now);
    const deadline = downPaymentDeadline(c.anchor, windowDays);
    const dayKey = istDateKey(now);

    // Past the deadline → automatic Operations transfer (FR-SAL-53, BR-10).
    if (now.getTime() > deadline.getTime()) {
      const out = await runOnce("day15-transfer", `day15-transfer:${c.enrollmentId}`, () => transferToOperations(c, now));
      if (out.ran) summary.transfers += 1;
      continue; // no more reminders once transferred
    }

    // Reminder on the configured days (FR-SAL-51/56).
    if (days.includes(n)) {
      const out = await runOnce("deadline-reminder", `deadline-reminder:${c.enrollmentId}:${dayKey}`, async () => {
        await notifyUser({
          recipientId: c.salespersonId, recipientEmail: c.salespersonEmail, type: "DEADLINE_REMINDER",
          subject: `Down payment due — ${c.learnerName}`,
          body: `Day ${n} of ${windowDays}. The Down Payment for ${c.learnerName} is due by ${deadline.toISOString()}. ${windowDays - n} day(s) remain.`,
          relatedEntityType: "Enrollment", relatedEntityId: c.enrollmentId,
        });
        if (learnerRemind === true && c.learnerEmail) {
          await sendEmail({ to: c.learnerEmail, subject: "Your down payment is due soon", body: `Your down payment is due by ${deadline.toDateString()}.` });
        }
        return { day: n };
      });
      if (out.ran) summary.remindersSent += 1;
    }

    // Day-13 "deadline approaching" alert to salesperson AND Sales Manager (FR-SAL-52/61).
    if (n === 13) {
      const out = await runOnce("deadline-approaching", `deadline-approaching:${c.enrollmentId}:${dayKey}`, async () => {
        const recipients = [{ id: c.salespersonId, email: c.salespersonEmail }, ...managers];
        for (const r of recipients) {
          await notifyUser({
            recipientId: r.id, recipientEmail: r.email, type: "DEADLINE_APPROACHING",
            subject: `Deadline approaching — ${c.learnerName}`,
            body: `Only 2 days remain to collect the Down Payment for ${c.learnerName} (due ${deadline.toISOString()}).`,
            relatedEntityType: "Enrollment", relatedEntityId: c.enrollmentId,
          });
        }
        return { recipients: recipients.length };
      });
      if (out.ran) summary.approachingAlerts += 1;
    }
  }
}

/**
 * Auto-transfer to Operations at end of Day 15 (FR-SAL-53, BR-10, BR-12). Sets the lead
 * status, records an Operations handover (the consolidated record IS Operations being
 * notified), and notifies the salesperson, Sales Manager, Nandhiya and Rajesh.
 */
async function transferToOperations(c: Candidate, now: Date): Promise<{ handoverId: string }> {
  const { buildHandoverSnapshot } = await import("@/server/services/handover");
  const snapshot = await buildHandoverSnapshot(c.enrollmentId);

  const handover = await db.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: c.leadId }, data: { status: LeadStatus.OPERATIONS_HANDOVER } });
    const h = await tx.operationsHandover.create({
      data: {
        enrollmentId: c.enrollmentId,
        handoverType: "AUTO_DAY15",
        validatedFlag: snapshot.complete,
        validationErrors: snapshot.complete ? undefined : { missing: snapshot.missing },
        handoverDate: now,
        generatedBy: SYSTEM_ACTOR.userId,
        snapshot: snapshot.record,
      },
    });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: c.leadId,
      action: "OPERATIONS_TRANSFER",
      changes: [
        { field: "status", oldValue: LeadStatus.DOWN_PAYMENT_PENDING, newValue: LeadStatus.OPERATIONS_HANDOVER },
        { field: "handoverType", oldValue: null, newValue: "AUTO_DAY15" },
      ],
      actor: SYSTEM_ACTOR,
    });
    return h;
  });

  const [managers, auditors, finance] = await Promise.all([
    usersInRoles([Role.SALES_MANAGER]),
    usersInRoles([Role.DATA_MGMT_AUDITOR]),
    usersInRoles([Role.FINANCE_REVIEWER]),
  ]);
  const body = `The Down Payment for ${c.learnerName} was not received within the deadline. The lead has been automatically transferred to Operations.`;
  const recipients = [
    { id: c.salespersonId, email: c.salespersonEmail },
    ...managers, ...auditors, ...finance,
  ];
  for (const r of recipients) {
    await notifyUser({
      recipientId: r.id, recipientEmail: r.email, type: "DOWN_PAYMENT_OVERDUE",
      subject: `Auto-transfer to Operations — ${c.learnerName}`, body,
      relatedEntityType: "Enrollment", relatedEntityId: c.enrollmentId,
    });
  }
  return { handoverId: handover.id };
}

/**
 * The active down-payment countdowns visible to a salesperson (own leads) or a manager
 * (all) — the pending payment, days remaining and exact deadline (FR-SAL-50). Read-only.
 */
export interface Countdown {
  leadId: string;
  learnerName: string;
  daysRemaining: number;
  deadline: string;
  overdue: boolean;
}

export async function downPaymentCountdowns(actor: Actor, now: Date = new Date()): Promise<Countdown[]> {
  const windowDays = await getConfigNumber("down_payment_window_days", 15);
  const scopeAll = actor.role === Role.SALES_MANAGER || actor.role === Role.SUPER_ADMIN;
  const rows = await db.enrollment.findMany({
    where: {
      courseStartedFlag: true,
      lead: { voided: false, status: LeadStatus.DOWN_PAYMENT_PENDING, ...(scopeAll ? {} : { salespersonId: actor.userId }) },
      payments: { some: { paymentNumber: 1, auditStatus: AuditStatus.APPROVED, voided: false } },
    },
    include: {
      lead: { select: { id: true, fullName: true } },
      payments: { where: { paymentNumber: 1, auditStatus: AuditStatus.APPROVED, voided: false }, take: 1 },
    },
  });
  return rows
    .filter((e) => e.payments[0]?.auditedAt)
    .map((e) => {
      const deadline = downPaymentDeadline(e.payments[0]!.auditedAt!, windowDays);
      const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
      return { leadId: e.lead.id, learnerName: e.lead.fullName, daysRemaining, deadline: deadline.toISOString(), overdue: now.getTime() > deadline.getTime() };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

// ── Stale-lead nudges (FR-SAL-58/59) ─────────────────────────────────────────

async function staleTriggers(now: Date, summary: AutomationSummary): Promise<void> {
  const dayKey = istDateKey(now);
  const basicHours = await getConfigNumber("basic_incomplete_hours", 24);
  const draftHours = await getConfigNumber("draft_no_payment_hours", 48);

  // FR-SAL-58: interested 24h+ ago but basic details still incomplete.
  const staleBasic = await db.lead.findMany({
    where: {
      voided: false,
      status: { in: [LeadStatus.INTERESTED, LeadStatus.BASIC_DETAILS_PENDING] },
      updatedAt: { lt: new Date(now.getTime() - basicHours * 3_600_000) },
    },
    include: { salesperson: { select: { id: true, email: true } } },
    take: 500,
  });
  for (const l of staleBasic) {
    const out = await runOnce("stale-basic", `stale-basic:${l.id}:${dayKey}`, () =>
      notifyUser({ recipientId: l.salesperson.id, recipientEmail: l.salesperson.email, type: "BASIC_DETAILS_INCOMPLETE", subject: `Complete basic details — ${l.fullName}`, body: `${l.fullName} was marked Interested but basic details are still incomplete.`, relatedEntityType: "Lead", relatedEntityId: l.id }),
    );
    if (out.ran) summary.staleNudges += 1;
  }

  // FR-SAL-59: draft generated 48h+ ago but no payment recorded.
  const staleDraft = await db.lead.findMany({
    where: {
      voided: false,
      status: { in: [LeadStatus.PAYMENT_DRAFT_GENERATED, LeadStatus.PAYMENT_PENDING] },
      enrollment: { drafts: { some: { generatedAt: { lt: new Date(now.getTime() - draftHours * 3_600_000) } } }, payments: { none: {} } },
    },
    include: { salesperson: { select: { id: true, email: true } } },
    take: 500,
  });
  for (const l of staleDraft) {
    const out = await runOnce("stale-draft", `stale-draft:${l.id}:${dayKey}`, () =>
      notifyUser({ recipientId: l.salesperson.id, recipientEmail: l.salesperson.email, type: "DRAFT_NO_PAYMENT", subject: `No payment yet — ${l.fullName}`, body: `A payment draft was shared for ${l.fullName} but no payment has been recorded.`, relatedEntityType: "Lead", relatedEntityId: l.id }),
    );
    if (out.ran) summary.staleNudges += 1;
  }
}

// ── Follow-up tasks due (FR-SAL-66) ───────────────────────────────────────────

async function followUpDue(now: Date, summary: AutomationSummary): Promise<void> {
  const dayKey = istDateKey(now);
  const due = await db.followUpTask.findMany({
    where: { status: "OPEN", dueDate: { lte: now } },
    include: { lead: { select: { fullName: true } } },
    take: 500,
  });
  for (const t of due) {
    const out = await runOnce("follow-up-due", `follow-up-due:${t.id}:${dayKey}`, () =>
      notifyUser({ recipientId: t.assignedTo, type: "FOLLOW_UP_DUE", subject: `Follow-up due — ${t.lead.fullName}`, body: t.description, relatedEntityType: "Lead", relatedEntityId: t.leadId }),
    );
    if (out.ran) summary.followUpsDue += 1;
  }
}

// ── Ageing escalation for Nandhiya's queue (feeds FR-SA-04) ────────────────────

async function ageingEscalation(now: Date, summary: AutomationSummary): Promise<void> {
  const ageHours = await getConfigNumber("audit_ageing_threshold_hours", 48);
  const aged = await db.payment.count({
    where: { auditStatus: { in: [AuditStatus.PENDING_AUDIT, AuditStatus.RESUBMITTED] }, voided: false, submittedAt: { lt: new Date(now.getTime() - ageHours * 3_600_000) } },
  });
  if (aged === 0) return;
  const auditors = await usersInRoles([Role.DATA_MGMT_AUDITOR]);
  const out = await runOnce("audit-ageing", `audit-ageing:${istDateKey(now)}`, async () => {
    for (const a of auditors) {
      await notifyUser({ recipientId: a.id, recipientEmail: a.email, type: "OPERATIONS_HANDOVER", subject: "Audit queue ageing", body: `${aged} payment(s) have been awaiting audit beyond ${ageHours}h.` });
    }
    return { aged };
  });
  if (out.ran) summary.ageingEscalations += 1;
}

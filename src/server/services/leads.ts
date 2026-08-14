/**
 * Sales / lead lifecycle service (FR-SAL-01..19, BR-02). Ownership is enforced in the
 * QUERY, not the UI: a salesperson sees and touches only their own leads; managers and
 * above see all. Basic details are entered ONCE and reused everywhere (BR-02). Money and
 * balances are always computed server-side (BR-28); the browser never sends a rupee.
 */
import "server-only";
import {
  Role,
  LeadStatus,
  Program,
  Plan,
  ComboMode,
  ConcessionStatus,
  ConcessionThresholdType,
  UserStatus,
  AuditStatus,
  type Prisma,
} from "@prisma/client";
import { db, type DbTx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import {
  requirePermission,
  requireRecordAccess,
  canAccessLead,
  AuthorizationError,
  type Actor,
} from "@/server/auth/permissions";
import { money, round, sub, sum, calculateBalance, type Money } from "@/server/money";
import { calculateFee, getConcessionThreshold, applyConcession } from "@/server/services/pricing";
import { computeLeadStatus } from "@/server/services/lead-status";
import { notifyUser } from "@/server/notifications";

export class LeadError extends Error {
  readonly code = "LEAD_ERROR";
}

// ── Basic-detail completeness (FR-SAL-13) ─────────────────────────────────────

type LeadRecord = Prisma.LeadGetPayload<{ include: { enrollment: { include: { payments: true } } } }>;

/**
 * The MINIMAL set required to capture/advance a lead (business decision): name + email +
 * mobile. The rest of the record can be filled later. `isBasicComplete` below is the STRICT
 * full-record check used only by the Operations handover.
 */
export function isBasicMinimal(lead: { fullName: string | null; email: string | null; mobile: string | null }): boolean {
  return Boolean(
    lead.fullName &&
      lead.email &&
      /.+@.+\..+/.test(lead.email) &&
      lead.mobile &&
      /^(\+?\d{1,3}[- ]?)?\d{10}$/.test(lead.mobile),
  );
}

export function isBasicComplete(lead: {
  fullName: string | null;
  dob: Date | null;
  doorNo: string | null;
  street: string | null;
  address: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  email: string | null;
  mobile: string | null;
}): boolean {
  return Boolean(
    lead.fullName &&
      lead.dob &&
      lead.dob.getTime() < Date.now() &&
      lead.doorNo &&
      lead.street &&
      lead.address &&
      lead.district &&
      lead.state &&
      lead.pincode &&
      /^\d{6}$/.test(lead.pincode) &&
      lead.email &&
      /.+@.+\..+/.test(lead.email) &&
      lead.mobile &&
      /^(\+?\d{1,3}[- ]?)?\d{10}$/.test(lead.mobile),
  );
}

// ── Duplicate detection (FR-SAL-10) ───────────────────────────────────────────

export interface DuplicateHit {
  leadId: string;
  fullName: string;
  ownerName: string;
  status: LeadStatus;
}

/** Find an existing ACTIVE (non-voided) lead with the same mobile or email. */
export async function checkDuplicate(
  field: "mobile" | "email",
  value: string,
  excludeLeadId?: string,
): Promise<DuplicateHit | null> {
  const normalized = field === "email" ? value.trim().toLowerCase() : value.trim();
  const lead = await db.lead.findFirst({
    where: {
      voided: false,
      [field]: normalized,
      ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}),
    },
    include: { salesperson: { select: { name: true } } },
  });
  if (!lead) return null;
  return { leadId: lead.id, fullName: lead.fullName, ownerName: lead.salesperson.name, status: lead.status };
}

// ── Create / read ─────────────────────────────────────────────────────────────

export async function createLead(
  actor: Actor,
  input: { fullName: string; mobile?: string; email?: string; leadSource?: string },
): Promise<{ id: string }> {
  requirePermission(actor, "lead:create");
  // Block a duplicate active enrollment (FR-SAL-10).
  for (const field of ["mobile", "email"] as const) {
    const value = input[field];
    if (value) {
      const dup = await checkDuplicate(field, value);
      if (dup) {
        throw new LeadError(
          `A lead with that ${field} already exists (${dup.fullName}, owned by ${dup.ownerName}).`,
        );
      }
    }
  }

  const created = await db.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        fullName: input.fullName.trim(),
        mobile: input.mobile?.trim() ?? null,
        email: input.email?.trim().toLowerCase() ?? null,
        leadSource: input.leadSource?.trim() ?? null,
        salespersonId: actor.userId,
        status: LeadStatus.NEW_LEAD,
      },
    });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: lead.id,
      action: "CREATE",
      changes: [{ field: "status", oldValue: null, newValue: LeadStatus.NEW_LEAD }],
      actor,
    });
    return lead;
  });
  return { id: created.id };
}

/** Load a lead with ownership enforced — throws AuthorizationError if not permitted. */
export async function getLeadForActor(actor: Actor, leadId: string): Promise<LeadRecord> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { enrollment: { include: { payments: true } } },
  });
  if (!lead) throw new AuthorizationError("This lead was not found or is not yours to view.");
  requireRecordAccess(actor, lead); // salesperson → own only; managers/above → all
  return lead;
}

// ── Basic details & interested (FR-SAL-08/09, §3.4) ───────────────────────────

export async function updateBasicDetails(
  actor: Actor,
  leadId: string,
  data: {
    fullName: string; email: string; mobile: string;
    dob?: string; doorNo?: string; street?: string; address?: string;
    district?: string; state?: string; pincode?: string;
    leadSource?: string; remarks?: string;
  },
): Promise<void> {
  const lead = await getLeadForActor(actor, leadId);
  requirePermission(actor, "lead:update:own");

  // Duplicate guard on mobile/email against OTHER active leads.
  for (const field of ["mobile", "email"] as const) {
    const dup = await checkDuplicate(field, data[field], leadId);
    if (dup) {
      throw new LeadError(
        `A lead with that ${field} already exists (${dup.fullName}, owned by ${dup.ownerName}).`,
      );
    }
  }

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        // Required.
        fullName: data.fullName.trim(),
        email: data.email.trim().toLowerCase(),
        mobile: data.mobile.trim(),
        // Optional — store null when not yet filled (keeps the handover's strict check honest).
        dob: data.dob?.trim() ? new Date(data.dob) : null,
        doorNo: data.doorNo?.trim() || null,
        street: data.street?.trim() || null,
        address: data.address?.trim() || null,
        district: data.district?.trim() || null,
        state: data.state?.trim() || null,
        pincode: data.pincode?.trim() || null,
        leadSource: data.leadSource?.trim() ?? lead.leadSource,
        remarks: data.remarks?.trim() ?? lead.remarks,
      },
    });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: leadId,
      action: "UPDATE_BASIC_DETAILS",
      changes: [{ field: "basicDetails", oldValue: null, newValue: "updated" }],
      actor,
    });
    await advanceLeadStatus(tx, leadId, actor);
  });
}

/** The only manual transition: NEW_LEAD → INTERESTED (FR §3.4). */
export async function markInterested(actor: Actor, leadId: string): Promise<void> {
  const lead = await getLeadForActor(actor, leadId);
  requirePermission(actor, "lead:update:own");
  if (lead.status !== LeadStatus.NEW_LEAD) return; // idempotent / already advanced
  await db.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { status: LeadStatus.INTERESTED } });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: leadId,
      action: "STATUS_TRANSITION",
      changes: [{ field: "status", oldValue: LeadStatus.NEW_LEAD, newValue: LeadStatus.INTERESTED }],
      actor,
    });
  });
}

// ── Course & plan selection (FR-SAL-14..19) ───────────────────────────────────

export async function selectCourse(
  actor: Actor,
  leadId: string,
  sel: {
    program: Program; plan: Plan; comboMode?: ComboMode | null;
    commencingDate?: string | null; batch?: string | null; courseStarted?: boolean;
  },
): Promise<void> {
  const lead = await getLeadForActor(actor, leadId);
  requirePermission(actor, "lead:update:own");

  const quote = await calculateFee({ program: sel.program, plan: sel.plan, comboMode: sel.comboMode ?? null });
  const commencingDate = sel.commencingDate ? new Date(sel.commencingDate) : null;
  const courseStarted =
    sel.courseStarted ?? (commencingDate ? commencingDate.getTime() <= Date.now() : false);

  const existing = lead.enrollment;
  const concessionAmount = existing?.concessionAmount ?? money(0);
  const finalApprovedFee = round(sub(quote.standardFee, concessionAmount));

  await db.$transaction(async (tx) => {
    await tx.enrollment.upsert({
      where: { leadId },
      create: {
        leadId,
        program: sel.program,
        plan: sel.plan,
        comboMode: sel.comboMode ?? null,
        commencingDate,
        batch: sel.batch ?? null,
        courseStartedFlag: courseStarted,
        pricingId: quote.pricingId,
        standardFee: quote.standardFee.toFixed(2),
        baseFee: quote.baseFee.toFixed(2),
        gstAmount: quote.gstAmount.toFixed(2),
        gstPercent: quote.gstPercent.toFixed(2),
        finalApprovedFee: finalApprovedFee.toFixed(2),
      },
      update: {
        program: sel.program,
        plan: sel.plan,
        comboMode: sel.comboMode ?? null,
        commencingDate,
        batch: sel.batch ?? existing?.batch ?? null,
        courseStartedFlag: courseStarted,
        pricingId: quote.pricingId,
        standardFee: quote.standardFee.toFixed(2),
        baseFee: quote.baseFee.toFixed(2),
        gstAmount: quote.gstAmount.toFixed(2),
        gstPercent: quote.gstPercent.toFixed(2),
        finalApprovedFee: finalApprovedFee.toFixed(2),
      },
    });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: leadId,
      action: "SELECT_COURSE",
      changes: [
        { field: "program", oldValue: existing?.program ?? null, newValue: sel.program },
        { field: "plan", oldValue: existing?.plan ?? null, newValue: sel.plan },
        { field: "standardFee", oldValue: existing?.standardFee ?? null, newValue: quote.standardFee.toFixed(2) },
      ],
      actor,
    });
    await advanceLeadStatus(tx, leadId, actor);
  });
}

// ── Concession request & decision (FR-SAL-25..30) ─────────────────────────────

export async function requestConcession(
  actor: Actor,
  leadId: string,
  input: { concessionType: ConcessionThresholdType; concessionValue: string; reason: string },
): Promise<{ status: ConcessionStatus }> {
  const lead = await getLeadForActor(actor, leadId);
  requirePermission(actor, "concession:create");
  const enrollment = lead.enrollment;
  if (!enrollment?.standardFee) throw new LeadError("Select a program and plan before requesting a concession.");

  const threshold = await getConcessionThreshold(enrollment.plan);
  const result = applyConcession({
    standardFee: enrollment.standardFee,
    concessionValue: input.concessionValue,
    concessionType: input.concessionType,
    threshold,
  });

  await db.$transaction(async (tx) => {
    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: {
        concessionAmount: result.concessionAmount.toFixed(2),
        concessionReason: input.reason.trim(),
        concessionStatus: result.concessionStatus,
        finalApprovedFee: result.finalApprovedFee.toFixed(2),
      },
    });
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: enrollment.id,
      action: "CONCESSION_REQUEST",
      changes: [
        { field: "concessionAmount", oldValue: enrollment.concessionAmount, newValue: result.concessionAmount.toFixed(2) },
        { field: "concessionStatus", oldValue: enrollment.concessionStatus, newValue: result.concessionStatus },
        { field: "reason", oldValue: null, newValue: input.reason.trim() },
      ],
      actor,
    });
  });

  if (result.concessionStatus === ConcessionStatus.PENDING_APPROVAL) {
    const managers = await db.user.findMany({
      where: { role: { in: [Role.SALES_MANAGER, Role.SUPER_ADMIN] }, status: UserStatus.ACTIVE },
    });
    for (const m of managers) {
      await notifyUser({
        recipientId: m.id,
        recipientEmail: m.email,
        type: "CONCESSION_PENDING",
        subject: "Concession awaiting approval",
        body: `A concession of ${result.concessionAmount.toFixed(2)} on lead "${lead.fullName}" needs your approval.`,
        relatedEntityType: "Lead",
        relatedEntityId: leadId,
      });
    }
  }
  return { status: result.concessionStatus };
}

export async function decideConcession(
  actor: Actor,
  leadId: string,
  decision: "APPROVE" | "REJECT",
  reason: string,
): Promise<void> {
  requirePermission(actor, "concession:approve");
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { enrollment: true } });
  if (!lead?.enrollment) throw new LeadError("Lead or enrollment not found.");
  const enrollment = lead.enrollment;
  if (enrollment.concessionStatus !== ConcessionStatus.PENDING_APPROVAL) {
    throw new LeadError("There is no pending concession to decide on this lead.");
  }

  await db.$transaction(async (tx) => {
    if (decision === "APPROVE") {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { concessionStatus: ConcessionStatus.APPROVED },
      });
    } else {
      // Reject → drop the concession, revert to the standard fee.
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          concessionStatus: ConcessionStatus.REJECTED,
          concessionAmount: "0",
          finalApprovedFee: enrollment.standardFee ?? undefined,
        },
      });
    }
    await writeAudit(tx, {
      entityType: "Enrollment",
      entityId: enrollment.id,
      action: decision === "APPROVE" ? "CONCESSION_APPROVE" : "CONCESSION_REJECT",
      changes: [
        { field: "concessionStatus", oldValue: enrollment.concessionStatus, newValue: decision === "APPROVE" ? ConcessionStatus.APPROVED : ConcessionStatus.REJECTED },
        { field: "reason", oldValue: null, newValue: reason.trim() },
      ],
      actor,
    });
    await advanceLeadStatus(tx, leadId, actor);
  });

  await notifyUser({
    recipientId: lead.salespersonId,
    type: "CONCESSION_DECISION",
    subject: `Concession ${decision === "APPROVE" ? "approved" : "rejected"}`,
    body: `The concession on lead "${lead.fullName}" was ${decision === "APPROVE" ? "approved" : "rejected"}: ${reason.trim()}`,
    relatedEntityType: "Lead",
    relatedEntityId: leadId,
  });
}

// ── Status transition (FR §3.4) ───────────────────────────────────────────────

/**
 * Recompute the lead status from the real state of the enrollment and its payments and
 * persist it, auditing any transition. System-driven — call after every relevant
 * mutation. Runs inside the caller's transaction.
 */
export async function advanceLeadStatus(tx: DbTx, leadId: string, actor: Actor): Promise<LeadStatus> {
  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    include: { enrollment: { include: { payments: true } } },
  });
  if (!lead) throw new LeadError("Lead not found.");

  const enrollment = lead.enrollment;
  const draft = enrollment
    ? await tx.paymentDraft.findFirst({ where: { enrollmentId: enrollment.id } })
    : null;

  const computed = computeLeadStatus({
    interested: lead.status !== LeadStatus.NEW_LEAD,
    basicDetailsComplete: isBasicMinimal(lead), // capture needs only name/mobile/email (handover stays strict)
    draftGenerated: Boolean(draft),
    finalApprovedFee: enrollment?.finalApprovedFee?.toString() ?? null,
    payments: (enrollment?.payments ?? []).map((p) => ({
      paymentNumber: p.paymentNumber,
      auditStatus: p.auditStatus,
      voided: p.voided,
      receivedAmount: p.receivedAmount.toString(),
    })),
  });

  if (computed !== lead.status) {
    await tx.lead.update({ where: { id: leadId }, data: { status: computed } });
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: leadId,
      action: "STATUS_TRANSITION",
      changes: [{ field: "status", oldValue: lead.status, newValue: computed }],
      actor,
    });
  }
  return computed;
}

// ── Listing & dashboard (FR-SAL-01..06) ───────────────────────────────────────

export interface LeadFilters {
  status?: LeadStatus;
  program?: Program;
  plan?: Plan;
  leadSource?: string;
  search?: string;
  salespersonId?: string; // manager view
}

function scopeWhere(actor: Actor, filters: LeadFilters = {}): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { voided: false };
  // Ownership enforced in the QUERY (FR-SAL-01).
  if (!requireAll(actor)) {
    where.salespersonId = actor.userId;
  } else if (filters.salespersonId) {
    where.salespersonId = filters.salespersonId;
  }
  if (filters.status) where.status = filters.status;
  if (filters.leadSource) where.leadSource = filters.leadSource;
  if (filters.program || filters.plan) {
    where.enrollment = {
      ...(filters.program ? { program: filters.program } : {}),
      ...(filters.plan ? { plan: filters.plan } : {}),
    };
  }
  if (filters.search) {
    where.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { mobile: { contains: filters.search } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return where;
}

function requireAll(actor: Actor): boolean {
  return canAccessLead(actor, { salespersonId: "__none__" }); // true iff role has read:all
}

export async function listLeads(actor: Actor, filters: LeadFilters = {}) {
  const rows = await db.lead.findMany({
    where: scopeWhere(actor, filters),
    include: { enrollment: true, salesperson: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    mobile: r.mobile,
    email: r.email,
    status: r.status,
    ownerName: r.salesperson.name,
    program: r.enrollment?.program ?? null,
    plan: r.enrollment?.plan ?? null,
    finalApprovedFee: r.enrollment?.finalApprovedFee?.toFixed(2) ?? null,
    concessionStatus: r.enrollment?.concessionStatus ?? ConcessionStatus.NONE,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function sumApprovedThisMonth(where: Prisma.PaymentWhereInput): Promise<Money> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const payments = await db.payment.findMany({
    where: { ...where, auditStatus: AuditStatus.APPROVED, voided: false, paymentDate: { gte: start } },
    select: { receivedAmount: true },
  });
  return round(sum(payments.map((p) => p.receivedAmount.toString())));
}

export async function dashboardSummary(actor: Actor, filters: LeadFilters = {}) {
  const base = scopeWhere(actor, filters);
  const paymentScope: Prisma.PaymentWhereInput = requireAll(actor)
    ? filters.salespersonId
      ? { enrollment: { lead: { salespersonId: filters.salespersonId } } }
      : {}
    : { enrollment: { lead: { salespersonId: actor.userId } } };

  // 15-day window: course started, commencing within the last 15 days, still owing.
  const windowStart = new Date(Date.now() - 15 * 86_400_000);
  const [total, basicPending, paymentPending, downPending, fifteenDay, fullyPaid, corrections, collected] =
    await Promise.all([
      db.lead.count({ where: base }),
      db.lead.count({ where: { ...base, status: { in: [LeadStatus.NEW_LEAD, LeadStatus.INTERESTED, LeadStatus.BASIC_DETAILS_PENDING] } } }),
      db.lead.count({ where: { ...base, status: { in: [LeadStatus.PAYMENT_DRAFT_GENERATED, LeadStatus.PAYMENT_PENDING] } } }),
      db.lead.count({ where: { ...base, status: LeadStatus.DOWN_PAYMENT_PENDING } }),
      db.lead.count({ where: { ...base, status: LeadStatus.DOWN_PAYMENT_PENDING, enrollment: { courseStartedFlag: true, commencingDate: { lte: new Date(), gte: windowStart } } } }),
      db.lead.count({ where: { ...base, status: LeadStatus.FULLY_PAID } }),
      db.payment.count({ where: { ...paymentScope, auditStatus: AuditStatus.CORRECTION_REQUIRED, voided: false } }),
      sumApprovedThisMonth(paymentScope),
    ]);

  return {
    totalLeads: total,
    basicDetailsPending: basicPending,
    paymentPending,
    downPaymentPending: downPending,
    fifteenDayApproaching: fifteenDay,
    fullyPaid,
    correctionsRequired: corrections,
    totalCollectedThisMonth: collected.toFixed(2),
  };
}

/** Balance from approved payments only (BR-22) — used by list/detail views. */
export function leadBalance(finalApprovedFee: string | null, payments: { receivedAmount: string; auditStatus: AuditStatus; voided: boolean }[]): string {
  if (!finalApprovedFee) return "0.00";
  return calculateBalance(finalApprovedFee, payments).toFixed(2);
}

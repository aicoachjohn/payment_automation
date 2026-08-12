/**
 * Finance dashboard reads (FR-FIN-01..26, BR-18). Rajesh's view is READ-ONLY BY
 * DESIGN: there is not a single mutation in this file. Every figure derives solely
 * from Nandhiya-approved, non-voided payment records, and every query that feeds a
 * total or the statement is composed on the ONE predicate — `financeVisiblePaymentWhere`
 * (FR-DM-20, BR-15). There is no bypass path.
 *
 * The single exception to "approved-only" is the per-customer payment HISTORY
 * (FR-FIN-16) and the audit timeline (FR-FIN-09): those are transparency views that
 * show a payment's full lifecycle and outcome (including rejected/pending) so Rajesh
 * can see what happened — but such rows never enter any statement or total. Verify #5
 * relies on exactly this: a rejected payment appears in history, in no total.
 *
 * All money arithmetic and formatting goes through `src/server/money`. This module
 * contains NOT ONE mutation of any kind — it is reads only. (The export-audit write
 * lives in `finance-export.ts`; the FinanceQuery write lives in `finance-queries.ts`.)
 */
import "server-only";
import { AuditStatus, PaymentType, Program, Plan, type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import { financeVisiblePaymentWhere, isVisibleToFinance } from "@/server/services/finance-visibility";
import { getConfigNumber } from "@/server/services/system-config";
import { money, sum, round, sub, add, extractBase, gt, lte } from "@/server/money";

export class FinanceError extends Error {
  readonly code = "FINANCE_ERROR";
}

/** Follow-up payments = down payment + final payment (FR-FIN-19). */
const FOLLOW_UP_TYPES: PaymentType[] = [PaymentType.DOWN_PAYMENT, PaymentType.FINAL_PAYMENT];

/** Append `amount` to the list keyed by `key`, creating the list on first use. */
function pushTo<K>(map: Map<K, string[]>, key: K, amount: string): void {
  const list = map.get(key);
  if (list) list.push(amount);
  else map.set(key, [amount]);
}

// ── Date helpers (UTC month boundaries; display is IST at the edge) ───────────

export function monthRange(year: number, month1to12: number): { from: Date; to: Date } {
  const from = new Date(Date.UTC(year, month1to12 - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month1to12, 1, 0, 0, 0, 0));
  return { from, to };
}

// ── Shared building blocks ────────────────────────────────────────────────────

/** Approved, non-voided received totals per enrollment (BR-22). Never trusts a stored
 *  total — it is always recomputed from the approved rows (BR-28, FR-REC-06). */
async function approvedTotalsByEnrollment(enrollmentIds: string[]): Promise<Map<string, string>> {
  if (enrollmentIds.length === 0) return new Map();
  const grouped = await db.payment.groupBy({
    by: ["enrollmentId"],
    where: financeVisiblePaymentWhere({ enrollmentId: { in: enrollmentIds } }),
    _sum: { receivedAmount: true },
  });
  const map = new Map<string, string>();
  for (const g of grouped) {
    map.set(g.enrollmentId, round(g._sum.receivedAmount?.toString() ?? "0").toFixed(2));
  }
  return map;
}

/** Base/GST split of one GST-inclusive received amount (FR-FIN-24, FR-REC-08). Rounds
 *  once so base + gst === received exactly at 2dp. */
function splitGst(receivedAmount: string, gstPercent: string): { base: string; gst: string } {
  const received = round(receivedAmount);
  const base = round(extractBase(received, gstPercent));
  const gst = round(sub(received, base));
  return { base: base.toFixed(2), gst: gst.toFixed(2) };
}

/** Concession / special-pricing marker for a row (FR-SAL-30). */
function specialMarker(e: {
  concessionStatus: string;
  concessionAmount: Prisma.Decimal;
  specialPricingName?: string | null;
}): string | null {
  if (e.specialPricingName) return e.specialPricingName;
  if (e.concessionStatus !== "NONE" && gt(e.concessionAmount.toString(), "0")) return "Concession";
  if (e.concessionStatus !== "NONE") return "Concession";
  return null;
}

/** Salespeople, for the finance filter dropdowns (read-only). */
export async function listSalespeople(actor: Actor): Promise<{ id: string; name: string }[]> {
  requirePermission(actor, "finance:read");
  const { Role } = await import("@prisma/client");
  return db.user.findMany({
    where: { role: { in: [Role.SALESPERSON, Role.SALES_MANAGER] }, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// ── Daily / period approved-payment statement (FR-FIN-01..05) ─────────────────

export interface StatementFilters {
  from?: string; // ISO date (payment date lower bound, inclusive)
  to?: string; // ISO date (payment date upper bound, inclusive end-of-day)
  paymentType?: PaymentType;
  typeGroup?: "holding" | "followup"; // FR-FIN-19 dedicated views
  program?: Program;
  plan?: Plan;
  salespersonId?: string;
  search?: string;
}

function statementWhere(filters: StatementFilters): Prisma.PaymentWhereInput {
  const extra: Prisma.PaymentWhereInput = {};
  if (filters.from || filters.to) {
    const paymentDate: Prisma.DateTimeFilter = {};
    if (filters.from) paymentDate.gte = new Date(filters.from);
    if (filters.to) {
      // inclusive end-of-day for a plain date
      const to = new Date(filters.to);
      to.setUTCHours(23, 59, 59, 999);
      paymentDate.lte = to;
    }
    extra.paymentDate = paymentDate;
  }
  if (filters.paymentType) extra.paymentType = filters.paymentType;
  if (filters.typeGroup === "holding") extra.paymentType = PaymentType.COURSE_HOLDING;
  if (filters.typeGroup === "followup") extra.paymentType = { in: FOLLOW_UP_TYPES };
  if (filters.program || filters.plan || filters.salespersonId) {
    extra.enrollment = {
      ...(filters.program ? { program: filters.program } : {}),
      ...(filters.plan ? { plan: filters.plan } : {}),
      ...(filters.salespersonId ? { lead: { salespersonId: filters.salespersonId } } : {}),
    };
  }
  if (filters.search) {
    extra.OR = [
      { transactionId: { contains: filters.search, mode: "insensitive" } },
      { enrollment: { lead: { fullName: { contains: filters.search, mode: "insensitive" } } } },
      { enrollment: { lead: { mobile: { contains: filters.search } } } },
      { enrollment: { lead: { email: { contains: filters.search, mode: "insensitive" } } } },
    ];
  }
  return financeVisiblePaymentWhere(extra);
}

export interface StatementRow {
  id: string;
  learnerName: string;
  mobile: string | null;
  email: string | null;
  program: Program;
  plan: Plan;
  comboMode: string | null;
  paymentType: PaymentType;
  paymentNumber: number;
  expectedAmount: string;
  receivedAmount: string;
  paymentDate: string;
  paymentMethod: string;
  transactionId: string;
  proofId: string | null;
  totalReceivedToDate: string;
  balance: string;
  salesperson: string;
  approvedBy: string | null;
  approvedAt: string | null;
  commencingDate: string | null;
  specialMarker: string | null;
}

export interface StatementResult {
  rows: StatementRow[];
  total: string;
  count: number;
}

/** The approved-payment statement for a date range (default: today). FR-FIN-01..05. */
export async function financeStatement(actor: Actor, filters: StatementFilters = {}): Promise<StatementResult> {
  requirePermission(actor, "finance:read");
  const rows = await db.payment.findMany({
    where: statementWhere(filters),
    orderBy: [{ paymentDate: "desc" }, { auditedAt: "desc" }],
    take: 1000,
    include: {
      proofs: { orderBy: { version: "desc" }, take: 1 },
      enrollment: {
        include: {
          pricing: { select: { specialPricingName: true } },
          lead: { include: { salesperson: { select: { name: true } } } },
        },
      },
    },
  });

  const enrollmentIds = [...new Set(rows.map((r) => r.enrollmentId))];
  const totals = await approvedTotalsByEnrollment(enrollmentIds);
  const approverIds = [...new Set(rows.map((r) => r.auditedBy).filter(Boolean) as string[])];
  const approvers = await db.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } });
  const approverName = new Map(approvers.map((u) => [u.id, u.name]));

  const statementRows: StatementRow[] = rows.map((p) => {
    const e = p.enrollment;
    const totalReceived = totals.get(p.enrollmentId) ?? "0.00";
    const balance = round(sub(e.finalApprovedFee?.toString() ?? "0", totalReceived)).toFixed(2);
    return {
      id: p.id,
      learnerName: e.lead.fullName,
      mobile: e.lead.mobile,
      email: e.lead.email,
      program: e.program,
      plan: e.plan,
      comboMode: e.comboMode,
      paymentType: p.paymentType,
      paymentNumber: p.paymentNumber,
      expectedAmount: p.expectedAmount.toFixed(2),
      receivedAmount: p.receivedAmount.toFixed(2),
      paymentDate: p.paymentDate.toISOString(),
      paymentMethod: p.paymentMethod,
      transactionId: p.transactionId,
      proofId: p.proofs[0]?.id ?? null,
      totalReceivedToDate: totalReceived,
      balance,
      salesperson: e.lead.salesperson.name,
      approvedBy: p.auditedBy ? approverName.get(p.auditedBy) ?? null : null,
      approvedAt: p.auditedAt?.toISOString() ?? null,
      commencingDate: e.commencingDate?.toISOString() ?? null,
      specialMarker: specialMarker({
        concessionStatus: e.concessionStatus,
        concessionAmount: e.concessionAmount,
        specialPricingName: e.pricing?.specialPricingName ?? null,
      }),
    };
  });

  const total = round(sum(statementRows.map((r) => r.receivedAmount))).toFixed(2);
  return { rows: statementRows, total, count: statementRows.length };
}

// ── Overview tiles (FRD 7.4) ──────────────────────────────────────────────────

export interface FinanceTile {
  key: string;
  label: string;
  count: number;
  value: string | null; // null → this tile has no money figure (e.g. counts)
  note?: string;
}

async function sumApproved(where: Prisma.PaymentWhereInput): Promise<{ count: number; value: string }> {
  const rows = await db.payment.findMany({ where: financeVisiblePaymentWhere(where), select: { receivedAmount: true } });
  return { count: rows.length, value: round(sum(rows.map((r) => r.receivedAmount.toString()))).toFixed(2) };
}

export async function financeOverview(actor: Actor, now: Date = new Date()): Promise<FinanceTile[]> {
  requirePermission(actor, "finance:read");
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const thisMonth = monthRange(y, m);
  const prevMonth = m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1);
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  const [approvedToday, monthColl, prevColl, holding, followUp, awaiting] = await Promise.all([
    // "Approved Today" = approval activity (auditedAt today) — the newly-approved indicator.
    sumApproved({ auditedAt: { gte: startOfToday } }),
    sumApproved({ paymentDate: { gte: thisMonth.from, lt: thisMonth.to } }),
    sumApproved({ paymentDate: { gte: prevMonth.from, lt: prevMonth.to } }),
    sumApproved({ paymentType: PaymentType.COURSE_HOLDING, paymentDate: { gte: thisMonth.from, lt: thisMonth.to } }),
    sumApproved({ paymentType: { in: FOLLOW_UP_TYPES }, paymentDate: { gte: thisMonth.from, lt: thisMonth.to } }),
    // Informational count ONLY — never a value, so no unapproved amount reaches Finance (BR-15).
    db.payment.count({ where: { auditStatus: { in: [AuditStatus.PENDING_AUDIT, AuditStatus.RESUBMITTED] }, voided: false } }),
  ]);

  // Fully-paid / outstanding / new customers are computed from approved records too.
  const { fullyPaid, outstandingValue, outstandingCount } = await enrollmentBalanceRollup();
  const newCustomers = await newCustomersThisMonth(thisMonth);

  const delta = round(sub(monthColl.value, prevColl.value));
  let deltaNote = "no prior-month figure";
  if (gt(prevColl.value, "0")) {
    const pct = round(money(delta).div(prevColl.value).times(100));
    deltaNote = `${gt(delta.toString(), "0") ? "+" : ""}${pct.toFixed(1)}% vs last month`;
  }

  return [
    { key: "approvedToday", label: "Approved Today", count: approvedToday.count, value: approvedToday.value },
    { key: "collectionMonth", label: "Collection This Month", count: monthColl.count, value: monthColl.value, note: deltaNote },
    { key: "courseHolding", label: "Course Holding (month)", count: holding.count, value: holding.value },
    { key: "followUp", label: "Follow-up (month)", count: followUp.count, value: followUp.value },
    { key: "fullyPaid", label: "Fully Paid Enrollments", count: fullyPaid, value: null },
    { key: "outstanding", label: "Total Outstanding", count: outstandingCount, value: outstandingValue },
    { key: "newCustomers", label: "New Customers (month)", count: newCustomers, value: null },
    { key: "awaitingAudit", label: "Records Awaiting Audit", count: awaiting, value: null, note: "informational — not a Finance total" },
  ];
}

/** Roll up every enrollment's approved balance once: fully-paid count + outstanding. */
async function enrollmentBalanceRollup(): Promise<{ fullyPaid: number; outstandingValue: string; outstandingCount: number }> {
  const enrollments = await db.enrollment.findMany({
    where: { finalApprovedFee: { not: null } },
    select: { id: true, finalApprovedFee: true },
  });
  if (enrollments.length === 0) return { fullyPaid: 0, outstandingValue: "0.00", outstandingCount: 0 };
  const totals = await approvedTotalsByEnrollment(enrollments.map((e) => e.id));
  let fullyPaid = 0;
  let outstandingCount = 0;
  let outstanding = money("0");
  for (const e of enrollments) {
    const received = totals.get(e.id) ?? "0.00";
    const fee = e.finalApprovedFee!.toString();
    const balance = round(sub(fee, received));
    // A customer is only "in play" for finance once they have an approved payment.
    if (money(received).lte(0)) continue;
    if (lte(balance.toString(), "0")) fullyPaid += 1;
    else {
      outstandingCount += 1;
      outstanding = add(outstanding, balance);
    }
  }
  return { fullyPaid, outstandingValue: round(outstanding).toFixed(2), outstandingCount };
}

/** Enrollments whose FIRST approved payment falls in the given month (new customers). */
async function newCustomersThisMonth(range: { from: Date; to: Date }): Promise<number> {
  const firstApproved = await db.payment.groupBy({
    by: ["enrollmentId"],
    where: financeVisiblePaymentWhere({}),
    _min: { paymentDate: true },
  });
  return firstApproved.filter((g) => {
    const d = g._min.paymentDate;
    return d && d >= range.from && d < range.to;
  }).length;
}

// ── Customer master sheet (FR-FIN-11..18) ─────────────────────────────────────

export interface CustomerFilters {
  search?: string;
  program?: Program;
  plan?: Plan;
  salespersonId?: string;
  paymentStatus?: "FULLY_PAID" | "PARTIAL" | "UNPAID";
  enrollmentStatus?: string;
  from?: string;
  to?: string;
}

export interface CustomerRow {
  enrollmentId: string;
  leadId: string;
  customerName: string;
  mobile: string | null;
  email: string | null;
  address: string | null;
  dob: string | null;
  program: Program;
  plan: Plan;
  comboMode: string | null;
  commencingDate: string | null;
  standardFee: string | null;
  concession: string;
  finalApprovedFee: string | null;
  totalReceived: string;
  balance: string;
  paymentStatus: "FULLY_PAID" | "PARTIAL" | "UNPAID";
  enrollmentStatus: string;
  salesperson: string;
  enrollmentDate: string;
  lastUpdated: string;
  incomplete: string[]; // list of missing fields (FR-FIN-17)
  specialMarker: string | null;
}

/** Full customer master. Only customers with at least one approved payment are
 *  visible to Finance — nothing enters this sheet before Nandhiya approves (BR-15). */
export async function customerMaster(actor: Actor, filters: CustomerFilters = {}): Promise<CustomerRow[]> {
  requirePermission(actor, "finance:read");

  // Which enrollments have an approved payment? (the finance-visible universe)
  const visible = await db.payment.groupBy({
    by: ["enrollmentId"],
    where: financeVisiblePaymentWhere({}),
    _sum: { receivedAmount: true },
    _max: { auditedAt: true },
  });
  const receivedByEnrollment = new Map(visible.map((g) => [g.enrollmentId, round(g._sum.receivedAmount?.toString() ?? "0").toFixed(2)]));
  const lastApprovedAt = new Map(visible.map((g) => [g.enrollmentId, g._max.auditedAt]));
  const visibleIds = visible.map((g) => g.enrollmentId);
  if (visibleIds.length === 0) return [];

  const where: Prisma.EnrollmentWhereInput = { id: { in: visibleIds } };
  if (filters.program) where.program = filters.program;
  if (filters.plan) where.plan = filters.plan;
  if (filters.enrollmentStatus) where.enrollmentStatus = filters.enrollmentStatus;
  const leadWhere: Prisma.LeadWhereInput = {};
  if (filters.salespersonId) leadWhere.salespersonId = filters.salespersonId;
  if (filters.from || filters.to) {
    leadWhere.createdAt = {};
    if (filters.from) leadWhere.createdAt.gte = new Date(filters.from);
    if (filters.to) {
      const to = new Date(filters.to);
      to.setUTCHours(23, 59, 59, 999);
      leadWhere.createdAt.lte = to;
    }
  }
  if (filters.search) {
    leadWhere.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { mobile: { contains: filters.search } },
      { email: { contains: filters.search, mode: "insensitive" } },
      { enrollment: { payments: { some: { transactionId: { contains: filters.search, mode: "insensitive" } } } } },
    ];
  }
  if (Object.keys(leadWhere).length > 0) where.lead = leadWhere;

  const enrollments = await db.enrollment.findMany({
    where,
    include: {
      pricing: { select: { specialPricingName: true } },
      lead: { include: { salesperson: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const rows: CustomerRow[] = [];
  for (const e of enrollments) {
    const received = receivedByEnrollment.get(e.id) ?? "0.00";
    const fee = e.finalApprovedFee?.toString() ?? null;
    const balance = fee ? round(sub(fee, received)).toFixed(2) : round(money("0").minus(received)).toFixed(2);
    const paymentStatus: CustomerRow["paymentStatus"] =
      money(received).lte(0) ? "UNPAID" : fee && lte(balance, "0") ? "FULLY_PAID" : "PARTIAL";
    if (filters.paymentStatus && filters.paymentStatus !== paymentStatus) continue;

    const l = e.lead;
    const incomplete: string[] = [];
    if (!l.mobile) incomplete.push("mobile");
    if (!l.email) incomplete.push("email");
    if (!l.doorNo || !l.street || !l.district || !l.state || !l.pincode) incomplete.push("address");
    if (!l.dob) incomplete.push("date of birth");

    const addressParts = [l.doorNo, l.street, l.district, l.state, l.pincode].filter(Boolean);
    const lastUpdated = [e.updatedAt, l.updatedAt, lastApprovedAt.get(e.id) ?? undefined]
      .filter(Boolean)
      .map((d) => (d as Date).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    rows.push({
      enrollmentId: e.id,
      leadId: e.leadId,
      customerName: l.fullName,
      mobile: l.mobile,
      email: l.email,
      address: addressParts.length ? addressParts.join(", ") : null,
      dob: l.dob?.toISOString() ?? null,
      program: e.program,
      plan: e.plan,
      comboMode: e.comboMode,
      commencingDate: e.commencingDate?.toISOString() ?? null,
      standardFee: e.standardFee?.toFixed(2) ?? null,
      concession: e.concessionAmount.toFixed(2),
      finalApprovedFee: e.finalApprovedFee?.toFixed(2) ?? null,
      totalReceived: received,
      balance,
      paymentStatus,
      enrollmentStatus: e.enrollmentStatus,
      salesperson: l.salesperson.name,
      enrollmentDate: l.createdAt.toISOString(),
      lastUpdated: new Date(lastUpdated).toISOString(),
      incomplete,
      specialMarker: specialMarker({
        concessionStatus: e.concessionStatus,
        concessionAmount: e.concessionAmount,
        specialPricingName: e.pricing?.specialPricingName ?? null,
      }),
    });
  }
  return rows;
}

// ── Per-customer payment history (FR-FIN-16, FR-FIN-09) ───────────────────────
// Transparency view: shows the FULL lifecycle including non-approved outcomes so
// Rajesh can see what happened. Non-approved rows are badged and NEVER counted — the
// `approvedTotal` here is computed strictly from approved rows.

export interface HistoryPayment {
  id: string;
  paymentNumber: number;
  paymentType: PaymentType;
  receivedAmount: string;
  paymentDate: string;
  paymentMethod: string;
  transactionId: string;
  auditStatus: AuditStatus;
  countedInTotals: boolean;
  proofId: string | null;
}

export async function customerPaymentHistory(
  actor: Actor,
  enrollmentId: string,
): Promise<{ payments: HistoryPayment[]; approvedTotal: string }> {
  requirePermission(actor, "finance:read");
  const payments = await db.payment.findMany({
    where: { enrollmentId, voided: false },
    orderBy: [{ paymentNumber: "asc" }, { submittedAt: "asc" }],
    include: { proofs: { orderBy: { version: "desc" }, take: 1 } },
  });
  const approvedTotal = round(
    sum(payments.filter((p) => p.auditStatus === AuditStatus.APPROVED).map((p) => p.receivedAmount.toString())),
  ).toFixed(2);
  return {
    approvedTotal,
    payments: payments.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      paymentType: p.paymentType,
      receivedAmount: p.receivedAmount.toFixed(2),
      paymentDate: p.paymentDate.toISOString(),
      paymentMethod: p.paymentMethod,
      transactionId: p.transactionId,
      auditStatus: p.auditStatus,
      countedInTotals: p.auditStatus === AuditStatus.APPROVED,
      proofId: p.proofs[0]?.id ?? null,
    })),
  };
}

// ── Single-payment detail + read-only audit history (FR-FIN-09) ───────────────

export interface FinancePaymentDetail {
  id: string;
  learnerName: string;
  program: Program;
  plan: Plan;
  paymentType: PaymentType;
  paymentNumber: number;
  auditStatus: AuditStatus;
  countedInTotals: boolean; // approved & non-voided → true
  receivedAmount: string;
  expectedAmount: string;
  paymentDate: string;
  paymentMethod: string;
  transactionId: string;
  approvedBy: string | null;
  approvedAt: string | null;
  salesperson: string;
  proofId: string | null;
  canRaiseQuery: boolean; // only against a finance-visible (approved) payment
}

export async function financePaymentDetail(actor: Actor, paymentId: string): Promise<FinancePaymentDetail | null> {
  requirePermission(actor, "finance:read");
  const p = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      proofs: { orderBy: { version: "desc" }, take: 1 },
      enrollment: { include: { lead: { include: { salesperson: { select: { name: true } } } } } },
    },
  });
  if (!p) return null;
  let approvedBy: string | null = null;
  if (p.auditedBy) {
    approvedBy = (await db.user.findUnique({ where: { id: p.auditedBy }, select: { name: true } }))?.name ?? null;
  }
  const visible = isVisibleToFinance(p);
  return {
    id: p.id,
    learnerName: p.enrollment.lead.fullName,
    program: p.enrollment.program,
    plan: p.enrollment.plan,
    paymentType: p.paymentType,
    paymentNumber: p.paymentNumber,
    auditStatus: p.auditStatus,
    countedInTotals: visible,
    receivedAmount: p.receivedAmount.toFixed(2),
    expectedAmount: p.expectedAmount.toFixed(2),
    paymentDate: p.paymentDate.toISOString(),
    paymentMethod: p.paymentMethod,
    transactionId: p.transactionId,
    approvedBy,
    approvedAt: p.auditedAt?.toISOString() ?? null,
    salesperson: p.enrollment.lead.salesperson.name,
    proofId: p.proofs[0]?.id ?? null,
    canRaiseQuery: visible,
  };
}

// ── Monthly collection summary (FR-FIN-20/21) ─────────────────────────────────

export interface MonthlySummary {
  year: number;
  month: number;
  total: string;
  count: number;
  byType: { key: PaymentType; label: string; value: string; count: number }[];
  byProgram: { key: Program; value: string; count: number }[];
  byPlan: { key: Plan; value: string; count: number }[];
  bySalesperson: { id: string; name: string; value: string; count: number }[];
}

const TYPE_LABEL: Record<PaymentType, string> = {
  COURSE_HOLDING: "Course Holding",
  COURSE_STARTING: "Course Starting",
  DOWN_PAYMENT: "Down Payment",
  FINAL_PAYMENT: "Final Payment",
};

export async function monthlyCollectionSummary(actor: Actor, year: number, month: number): Promise<MonthlySummary> {
  requirePermission(actor, "finance:read");
  const { from, to } = monthRange(year, month);
  const rows = await db.payment.findMany({
    where: financeVisiblePaymentWhere({ paymentDate: { gte: from, lt: to } }),
    select: {
      receivedAmount: true,
      paymentType: true,
      enrollment: { select: { program: true, plan: true, lead: { select: { salespersonId: true, salesperson: { select: { name: true } } } } } },
    },
  });

  const byTypeMap = new Map<PaymentType, string[]>();
  const byProgramMap = new Map<Program, string[]>();
  const byPlanMap = new Map<Plan, string[]>();
  const bySalespersonMap = new Map<string, { name: string; amounts: string[] }>();
  for (const r of rows) {
    const amt = r.receivedAmount.toString();
    pushTo(byTypeMap, r.paymentType, amt);
    pushTo(byProgramMap, r.enrollment.program, amt);
    pushTo(byPlanMap, r.enrollment.plan, amt);
    const sid = r.enrollment.lead.salespersonId;
    const entry = bySalespersonMap.get(sid) ?? { name: r.enrollment.lead.salesperson.name, amounts: [] };
    entry.amounts.push(amt);
    bySalespersonMap.set(sid, entry);
  }

  const total = round(sum(rows.map((r) => r.receivedAmount.toString()))).toFixed(2);
  return {
    year,
    month,
    total,
    count: rows.length,
    byType: Object.values(PaymentType).map((t) => ({
      key: t,
      label: TYPE_LABEL[t],
      value: round(sum(byTypeMap.get(t) ?? [])).toFixed(2),
      count: (byTypeMap.get(t) ?? []).length,
    })),
    byProgram: [...byProgramMap.entries()].map(([key, amts]) => ({ key, value: round(sum(amts)).toFixed(2), count: amts.length })),
    byPlan: [...byPlanMap.entries()].map(([key, amts]) => ({ key, value: round(sum(amts)).toFixed(2), count: amts.length })),
    bySalesperson: [...bySalespersonMap.entries()]
      .map(([id, v]) => ({ id, name: v.name, value: round(sum(v.amounts)).toFixed(2), count: v.amounts.length }))
      .sort((a, b) => (gt(a.value, b.value) ? -1 : 1)),
  };
}

// ── GST summary (FR-FIN-24) ───────────────────────────────────────────────────

export interface GstSummary {
  year: number;
  month: number;
  total: string;
  base: string;
  gst: string;
  count: number;
}

export async function gstSummary(actor: Actor, year: number, month: number): Promise<GstSummary> {
  requirePermission(actor, "finance:read");
  const { from, to } = monthRange(year, month);
  const rows = await db.payment.findMany({
    where: financeVisiblePaymentWhere({ paymentDate: { gte: from, lt: to } }),
    select: { receivedAmount: true, enrollment: { select: { gstPercent: true } } },
  });
  const fallbackGst = String(await getConfigNumber("gst_percent", 18));
  let base = money("0");
  let gst = money("0");
  let total = money("0");
  for (const r of rows) {
    const gstPercent = r.enrollment.gstPercent?.toString() ?? fallbackGst;
    const split = splitGst(r.receivedAmount.toString(), gstPercent);
    base = add(base, split.base);
    gst = add(gst, split.gst);
    total = add(total, r.receivedAmount.toString());
  }
  return {
    year,
    month,
    total: round(total).toFixed(2),
    base: round(base).toFixed(2),
    gst: round(gst).toFixed(2),
    count: rows.length,
  };
}

// ── Outstanding balance report (FR-FIN-22) ────────────────────────────────────

export interface OutstandingRow {
  enrollmentId: string;
  learnerName: string;
  mobile: string | null;
  program: Program;
  plan: Plan;
  finalApprovedFee: string;
  totalReceived: string;
  outstanding: string;
  paymentStage: string;
  daysOutstanding: number;
  salesperson: string;
}

export async function outstandingReport(actor: Actor, now: Date = new Date()): Promise<{ rows: OutstandingRow[]; total: string }> {
  requirePermission(actor, "finance:read");
  const enrollments = await db.enrollment.findMany({
    where: { finalApprovedFee: { not: null } },
    include: { lead: { include: { salesperson: { select: { name: true } } } } },
  });
  const totals = await approvedTotalsByEnrollment(enrollments.map((e) => e.id));
  // Latest approved payment date per enrollment → drives days-outstanding + stage.
  const latest = await db.payment.groupBy({
    by: ["enrollmentId"],
    where: financeVisiblePaymentWhere({}),
    _max: { paymentDate: true, paymentNumber: true },
  });
  const latestByEnrollment = new Map(latest.map((g) => [g.enrollmentId, g]));

  const rows: OutstandingRow[] = [];
  for (const e of enrollments) {
    const received = totals.get(e.id) ?? "0.00";
    if (money(received).lte(0)) continue; // no approved payment yet → not a finance customer
    const fee = e.finalApprovedFee!.toString();
    const outstanding = round(sub(fee, received));
    if (lte(outstanding.toString(), "0")) continue;
    const last = latestByEnrollment.get(e.id);
    const anchor = last?._max.paymentDate ?? e.commencingDate ?? e.lead.createdAt;
    const days = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / 86_400_000));
    rows.push({
      enrollmentId: e.id,
      learnerName: e.lead.fullName,
      mobile: e.lead.mobile,
      program: e.program,
      plan: e.plan,
      finalApprovedFee: round(fee).toFixed(2),
      totalReceived: received,
      outstanding: outstanding.toFixed(2),
      paymentStage: e.courseStartedFlag ? "Course started" : "Holding",
      daysOutstanding: days,
      salesperson: e.lead.salesperson.name,
    });
  }
  rows.sort((a, b) => (gt(a.outstanding, b.outstanding) ? -1 : 1));
  const total = round(sum(rows.map((r) => r.outstanding))).toFixed(2);
  return { rows, total };
}

// ── Month-on-month trend + payment-type mix (FR-FIN-23) ───────────────────────

export interface TrendPoint {
  year: number;
  month: number;
  label: string;
  value: string;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function collectionTrend(
  actor: Actor,
  months = 6,
  now: Date = new Date(),
): Promise<{ trend: TrendPoint[]; typeMix: { key: PaymentType; label: string; value: string }[] }> {
  requirePermission(actor, "finance:read");
  const points: TrendPoint[] = [];
  let earliest = now;
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const { from, to } = monthRange(d.getUTCFullYear(), d.getUTCMonth() + 1);
    if (from < earliest) earliest = from;
    const rows = await db.payment.findMany({
      where: financeVisiblePaymentWhere({ paymentDate: { gte: from, lt: to } }),
      select: { receivedAmount: true },
    });
    points.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      label: `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      value: round(sum(rows.map((r) => r.receivedAmount.toString()))).toFixed(2),
    });
  }

  const mixRows = await db.payment.findMany({
    where: financeVisiblePaymentWhere({ paymentDate: { gte: earliest } }),
    select: { receivedAmount: true, paymentType: true },
  });
  const mixMap = new Map<PaymentType, string[]>();
  for (const r of mixRows) {
    pushTo(mixMap, r.paymentType, r.receivedAmount.toString());
  }
  const typeMix = Object.values(PaymentType).map((t) => ({
    key: t,
    label: TYPE_LABEL[t],
    value: round(sum(mixMap.get(t) ?? [])).toFixed(2),
  }));
  return { trend: points, typeMix };
}

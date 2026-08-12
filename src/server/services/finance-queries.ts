/**
 * Finance Query threads (FR-FIN-10). Rajesh can raise a question against an approved
 * payment and thread comments with Nandhiya and the salesperson. This is the ONLY write
 * reachable from the Finance dashboard, and it is deliberately isolated from payment
 * data: it creates rows in `finance_query` / `finance_query_comment` and NEVER touches
 * the Payment row, so Finance stays read-only on every financial figure (BR-18).
 *
 * Raising a query notifies Nandhiya (Data Management) and the owning salesperson so the
 * question reaches the people who can act on it — without altering the record.
 */
import "server-only";
import { FinanceQueryStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import { requirePermission, requireRecordAccess, type Actor } from "@/server/auth/permissions";
import { financeVisiblePaymentWhere } from "@/server/services/finance-visibility";
import { notifyUser } from "@/server/notifications";

export class FinanceQueryError extends Error {
  readonly code = "FINANCE_QUERY_ERROR";
}

/** Raise a Finance Query against an approved payment. Notifies Nandhiya + salesperson. */
export async function raiseFinanceQuery(
  actor: Actor,
  input: { paymentId: string; subject: string; message: string },
): Promise<{ queryId: string }> {
  requirePermission(actor, "finance:query");

  // The query may only target a payment Finance can actually see (approved, non-voided).
  const payment = await db.payment.findFirst({
    where: financeVisiblePaymentWhere({ id: input.paymentId }),
    include: { enrollment: { include: { lead: { include: { salesperson: true } } } } },
  });
  if (!payment) throw new FinanceQueryError("That payment is not available to query.");
  requireRecordAccess(actor, payment.enrollment.lead);

  const query = await db.$transaction(async (tx) => {
    const q = await tx.financeQuery.create({
      data: {
        paymentId: payment.id,
        raisedBy: actor.userId,
        subject: input.subject.trim(),
        status: FinanceQueryStatus.OPEN,
        comments: {
          create: { authorId: actor.userId, authorRole: actor.role, body: input.message.trim() },
        },
      },
    });
    return q;
  });

  // Notify Nandhiya (all active auditors) and the owning salesperson.
  const auditors = await db.user.findMany({ where: { role: Role.DATA_MGMT_AUDITOR, status: "ACTIVE" }, select: { id: true, email: true } });
  const salesperson = payment.enrollment.lead.salesperson;
  const recipients = [
    ...auditors.map((a) => ({ id: a.id, email: a.email })),
    { id: salesperson.id, email: salesperson.email },
  ];
  await Promise.all(
    recipients.map((r) =>
      notifyUser({
        recipientId: r.id,
        recipientEmail: r.email,
        type: "FINANCE_QUERY",
        subject: `Finance query: ${input.subject.trim()}`,
        body: `Finance raised a query on payment ${payment.transactionId} for ${payment.enrollment.lead.fullName}. Open the query thread to respond.`,
        relatedEntityType: "FinanceQuery",
        relatedEntityId: query.id,
      }),
    ),
  );
  return { queryId: query.id };
}

/** Add a comment to an existing thread. Any participating role may comment. */
export async function addFinanceQueryComment(
  actor: Actor,
  input: { queryId: string; message: string },
): Promise<void> {
  const query = await db.financeQuery.findUnique({
    where: { id: input.queryId },
    include: { payment: { include: { enrollment: { include: { lead: true } } } } },
  });
  if (!query) throw new FinanceQueryError("That query no longer exists.");

  // Finance, the auditor and the owning salesperson may participate.
  const isFinance = actor.role === Role.FINANCE_REVIEWER || actor.role === Role.SUPER_ADMIN;
  const isAuditor = actor.role === Role.DATA_MGMT_AUDITOR;
  const isOwner = query.payment.enrollment.lead.salespersonId === actor.userId;
  if (!isFinance && !isAuditor && !isOwner) {
    throw new FinanceQueryError("You cannot comment on this query.");
  }
  if (isFinance) requirePermission(actor, "finance:query");

  await db.financeQueryComment.create({
    data: { queryId: query.id, authorId: actor.userId, authorRole: actor.role, body: input.message.trim() },
  });
  // A non-finance reply moves the thread to ANSWERED; finance may resolve separately.
  if (!isFinance && query.status === FinanceQueryStatus.OPEN) {
    await db.financeQuery.update({ where: { id: query.id }, data: { status: FinanceQueryStatus.ANSWERED } });
  }
}

/** Resolve (close) a thread. Only the finance reviewer who owns the view resolves it. */
export async function resolveFinanceQuery(actor: Actor, queryId: string): Promise<void> {
  requirePermission(actor, "finance:query");
  const query = await db.financeQuery.findUnique({ where: { id: queryId } });
  if (!query) throw new FinanceQueryError("That query no longer exists.");
  await db.financeQuery.update({ where: { id: queryId }, data: { status: FinanceQueryStatus.RESOLVED } });
}

export interface FinanceQueryThread {
  id: string;
  subject: string;
  status: FinanceQueryStatus;
  transactionId: string;
  learnerName: string;
  createdAt: string;
  updatedAt: string;
  comments: { id: string; body: string; authorName: string; authorRole: Role; at: string }[];
}

/** List query threads visible to the actor (finance sees all; salesperson sees own). */
export async function listFinanceQueries(actor: Actor): Promise<FinanceQueryThread[]> {
  const isFinance = actor.role === Role.FINANCE_REVIEWER || actor.role === Role.SUPER_ADMIN || actor.role === Role.DATA_MGMT_AUDITOR;
  const where = isFinance
    ? {}
    : { payment: { enrollment: { lead: { salespersonId: actor.userId } } } };
  const queries = await db.financeQuery.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      payment: { select: { transactionId: true, enrollment: { select: { lead: { select: { fullName: true } } } } } },
      comments: { orderBy: { createdAt: "asc" } },
    },
  });
  const authorIds = [...new Set(queries.flatMap((q) => q.comments.map((c) => c.authorId)))];
  const authors = await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } });
  const nameOf = new Map(authors.map((u) => [u.id, u.name]));
  return queries.map((q) => ({
    id: q.id,
    subject: q.subject,
    status: q.status,
    transactionId: q.payment.transactionId,
    learnerName: q.payment.enrollment.lead.fullName,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    comments: q.comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorName: nameOf.get(c.authorId) ?? "User",
      authorRole: c.authorRole,
      at: c.createdAt.toISOString(),
    })),
  }));
}

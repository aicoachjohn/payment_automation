/**
 * In-app notification centre + per-user email preferences (Phase 10, FR-SAL-58..66).
 * A user only ever sees / marks their OWN notifications — the recipient id is taken from
 * the authenticated actor, never from the client.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/permissions";

/** The catalogue of notification types a user can tune email delivery for. */
export const NOTIFICATION_TYPES: { type: string; label: string }[] = [
  { type: "BASIC_DETAILS_INCOMPLETE", label: "Basic details still incomplete" },
  { type: "DRAFT_NO_PAYMENT", label: "Draft sent but no payment recorded" },
  { type: "DOWN_PAYMENT_OUTSTANDING", label: "Down payment outstanding" },
  { type: "DEADLINE_REMINDER", label: "15-day deadline reminders" },
  { type: "DEADLINE_APPROACHING", label: "Deadline approaching (Day 13)" },
  { type: "DOWN_PAYMENT_OVERDUE", label: "Down payment overdue / transfer" },
  { type: "BALANCE_CLEARED", label: "Balance reached zero" },
  { type: "PAYMENT_CORRECTION", label: "Payment correction required" },
  { type: "PAYMENT_REJECTED", label: "Payment rejected" },
  { type: "FOLLOW_UP_DUE", label: "Follow-up task due" },
  { type: "OPERATIONS_HANDOVER", label: "Operations handover" },
  { type: "FINANCE_QUERY", label: "Finance queries" },
];

/** Only genuine in-app items (exclude future-scheduled digests that haven't been sent). */
const CENTER_WHERE: Prisma.NotificationWhereInput = { OR: [{ scheduledAt: null }, { sentAt: { not: null } }] };

export interface NotificationItem {
  id: string;
  type: string;
  subject: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  read: boolean;
  createdAt: string;
}

export async function listNotifications(actor: Actor, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationItem[]> {
  const rows = await db.notification.findMany({
    where: { recipientId: actor.userId, ...CENTER_WHERE, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    subject: r.subject,
    body: r.body,
    relatedEntityType: r.relatedEntityType,
    relatedEntityId: r.relatedEntityId,
    read: r.readAt != null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function unreadCount(actor: Actor): Promise<number> {
  return db.notification.count({ where: { recipientId: actor.userId, readAt: null, ...CENTER_WHERE } });
}

/** Mark one of the actor's notifications read (ownership enforced in the where clause). */
export async function markRead(actor: Actor, notificationId: string): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, recipientId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(actor: Actor): Promise<void> {
  await db.notification.updateMany({
    where: { recipientId: actor.userId, readAt: null, ...CENTER_WHERE },
    data: { readAt: new Date() },
  });
}

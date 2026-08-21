/**
 * In-app notification dispatch.
 *
 * **There is no email in this application.** Email delivery was removed by business
 * decision along with the password-reset flow — see CLAUDE.md. Every notification is an
 * in-app record, read from the notification centre at /notifications.
 *
 * Rule 11 still holds: every stage outcome reaches the people waiting on it, because a
 * Notification row is always written and always visible to its recipient. What changed is
 * that nobody is told by email as well, so the app has to be opened to be seen.
 *
 * Safe-logging rule (FR-SEC-31): never log payment amounts, Transaction IDs or full
 * personal-data payloads.
 */
import { db } from "@/server/db";

/**
 * Deliver a notification to a user.
 *
 * Always writes an IN_APP row, marked DELIVERED — there is no second channel that could
 * fail, so there is no FAILED state to reconcile and nothing for the Super Admin health
 * panel to chase.
 *
 * `relatedEntityType`/`relatedEntityId` let the centre link straight to the record.
 */
export async function notifyUser(args: {
  recipientId: string;
  type: string;
  subject: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Promise<void> {
  await db.notification.create({
    data: {
      recipientId: args.recipientId,
      type: args.type,
      channel: "IN_APP",
      subject: args.subject,
      body: args.body,
      relatedEntityType: args.relatedEntityType ?? null,
      relatedEntityId: args.relatedEntityId ?? null,
      status: "DELIVERED",
    },
  });
}

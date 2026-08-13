/**
 * Notification dispatch behind a provider interface (FR-AUTH-09/10, NFR-07a).
 *
 * Phase 2 ships a console/dev provider (selected by EMAIL_PROVIDER=console) so OTPs,
 * reset links and security alerts are observable in dev without a real email vendor.
 * Phase 10 wires the real provider behind this same interface. Every dispatch also
 * records a Notification row so it is auditable and viewable in-app.
 *
 * Safe-logging rule (FR-SEC-31): we never log payment amounts, Transaction IDs or full
 * personal-data payloads. OTP/reset values are dev-only and printed solely by the
 * console provider for local testing.
 */
import { db } from "@/server/db";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface NotificationProvider {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<void>;
}

/** Dev provider: prints to the server console. Never used in production. */
class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = "console";
  async sendEmail(message: EmailMessage): Promise<void> {
    console.info(
      `\n──── EMAIL (dev console provider) ────\n` +
        `to:      ${message.to}\n` +
        `subject: ${message.subject}\n` +
        `${message.body}\n` +
        `──────────────────────────────────────\n`,
    );
  }
}

/** No-op placeholder — logs a queued notice only (no body), for CI/tests. */
class StubEmailProvider implements NotificationProvider {
  readonly name = "stub";
  async sendEmail(message: EmailMessage): Promise<void> {
    console.info(`[stub email] queued to ${message.to}: ${message.subject}`);
  }
}

/**
 * Production email over the SendGrid v3 REST API using `fetch` (no SDK — keeps the fixed
 * stack). Selected by EMAIL_PROVIDER=sendgrid; keys come ONLY from env (FR-SEC-12). The
 * sending domain must have SPF/DKIM configured (D-04). A non-2xx response throws so the
 * caller marks the Notification FAILED and it surfaces on the Super Admin health panel.
 */
class SendGridEmailProvider implements NotificationProvider {
  readonly name = "sendgrid";
  async sendEmail(message: EmailMessage): Promise<void> {
    const apiKey = process.env.EMAIL_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) throw new Error("Email provider is not configured.");
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: from },
        subject: message.subject,
        content: [{ type: "text/plain", value: message.body }],
      }),
    });
    if (!res.ok) throw new Error(`Email delivery failed (${res.status}).`);
  }
}

let provider: NotificationProvider | null = null;

export function getNotificationProvider(): NotificationProvider {
  if (provider) return provider;
  switch (process.env.EMAIL_PROVIDER ?? "console") {
    case "sendgrid":
      provider = new SendGridEmailProvider();
      break;
    case "stub":
      provider = new StubEmailProvider();
      break;
    default:
      provider = new ConsoleNotificationProvider();
  }
  return provider;
}

/** Send an email through the configured provider. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  await getNotificationProvider().sendEmail(message);
}

/**
 * Whether EMAIL delivery is enabled for a user + notification type (FR-SAL-58..66). In-app
 * delivery is ALWAYS on; email is on by default and a preference row can switch it off.
 */
export async function isEmailEnabled(userId: string, type: string): Promise<boolean> {
  const pref = await db.notificationPreference.findUnique({ where: { userId_type: { userId, type } } });
  return pref ? pref.emailEnabled : true;
}

/**
 * Deliver a notification. An IN_APP row is ALWAYS written (it appears in the in-app
 * centre); EMAIL is additionally sent when the user's preference for this type allows it
 * and an address is known. Best-effort: a failed email marks the row FAILED (surfaced on
 * the Super Admin workflow-health panel, FR-SA-04) but never throws. WhatsApp stays behind
 * the `whatsapp_enabled` flag pending decision Q-01 and is not delivered here.
 */
export async function notifyUser(args: {
  recipientId: string;
  recipientEmail?: string;
  type: string;
  subject: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Promise<void> {
  const notif = await db.notification.create({
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

  if (args.recipientEmail && (await isEmailEnabled(args.recipientId, args.type))) {
    try {
      await sendEmail({ to: args.recipientEmail, subject: args.subject, body: args.body });
      await db.notification.update({ where: { id: notif.id }, data: { channel: "IN_APP+EMAIL", sentAt: new Date() } });
    } catch (e) {
      await db.notification.update({ where: { id: notif.id }, data: { status: "FAILED", failureReason: (e as Error).message.slice(0, 200) } });
    }
  }
}

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

/** No-op-ish placeholder for a real provider, wired in Phase 10. */
class StubEmailProvider implements NotificationProvider {
  readonly name = "stub";
  async sendEmail(message: EmailMessage): Promise<void> {
    // TODO-INTEGRATION (Phase 10): call the real EMAIL_PROVIDER using EMAIL_API_KEY.
    console.info(`[stub email] queued to ${message.to}: ${message.subject}`);
  }
}

let provider: NotificationProvider | null = null;

export function getNotificationProvider(): NotificationProvider {
  if (provider) return provider;
  provider =
    (process.env.EMAIL_PROVIDER ?? "console") === "console"
      ? new ConsoleNotificationProvider()
      : new StubEmailProvider();
  return provider;
}

/** Send an email through the configured provider. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  await getNotificationProvider().sendEmail(message);
}

/**
 * Record an in-app notification for a user and (best-effort) email it. Used for
 * security alerts: Super Admin login → Rajesh, lockout → Super Admin, break-glass →
 * primary Super Admin + Rajesh.
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
  await db.notification.create({
    data: {
      recipientId: args.recipientId,
      type: args.type,
      channel: "EMAIL",
      subject: args.subject,
      body: args.body,
      relatedEntityType: args.relatedEntityType ?? null,
      relatedEntityId: args.relatedEntityId ?? null,
      status: "SENT",
      sentAt: new Date(),
    },
  });
  if (args.recipientEmail) {
    await sendEmail({ to: args.recipientEmail, subject: args.subject, body: args.body });
  }
}

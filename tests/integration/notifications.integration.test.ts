// @vitest-environment node
/**
 * Phase 10 — notification engine: the in-app centre (unread counts, mark-as-read) and the
 * per-user email preference (in-app is always on; email is opt-out per type, FR-SAL-58..66).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { notifyUser } = await import("@/server/notifications");
const center = await import("@/server/notifications/center");

const prisma = new PrismaClient();
let actor: { userId: string; role: Role };
const TYPE = "DEADLINE_REMINDER";

async function cleanup() {
  await prisma.notification.deleteMany({ where: { recipientId: actor.userId, subject: { startsWith: "NOTIF-IT" } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: actor.userId, type: TYPE } });
}

beforeAll(async () => {
  actor = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "hari@proitbridge.local" } })).id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("in-app centre — unread + mark read", () => {
  it("delivers in-app, counts unread, and clears on mark-read", async () => {
    const before = await center.unreadCount(actor);
    await notifyUser({ recipientId: actor.userId, recipientEmail: "hari@proitbridge.local", type: TYPE, subject: "NOTIF-IT one", body: "b" });
    await notifyUser({ recipientId: actor.userId, type: TYPE, subject: "NOTIF-IT two", body: "b" });
    expect(await center.unreadCount(actor)).toBe(before + 2);

    const items = (await center.listNotifications(actor)).filter((i) => i.subject.startsWith("NOTIF-IT"));
    expect(items.length).toBe(2);
    await center.markRead(actor, items[0].id);
    expect(await center.unreadCount(actor)).toBe(before + 1);
    await center.markAllRead(actor);
    expect(await center.unreadCount(actor)).toBe(0);
  });
});

describe("email preference gating (in-app always on)", () => {
  it("email OFF suppresses the email but still delivers in-app", async () => {
    await center.setPreference(actor, TYPE, false);
    await notifyUser({ recipientId: actor.userId, recipientEmail: "hari@proitbridge.local", type: TYPE, subject: "NOTIF-IT nomail", body: "b" });
    const row = await prisma.notification.findFirstOrThrow({ where: { recipientId: actor.userId, subject: "NOTIF-IT nomail" } });
    // In-app row exists; because email is off, it was NOT emailed (channel stays IN_APP, no sentAt).
    expect(row.channel).toBe("IN_APP");
    expect(row.sentAt).toBeNull();

    await center.setPreference(actor, TYPE, true);
    await notifyUser({ recipientId: actor.userId, recipientEmail: "hari@proitbridge.local", type: TYPE, subject: "NOTIF-IT withmail", body: "b" });
    const row2 = await prisma.notification.findFirstOrThrow({ where: { recipientId: actor.userId, subject: "NOTIF-IT withmail" } });
    expect(row2.channel).toBe("IN_APP+EMAIL");
    expect(row2.sentAt).not.toBeNull();
  });

  it("getPreferences reflects the saved choice", async () => {
    await center.setPreference(actor, TYPE, false);
    const prefs = await center.getPreferences(actor);
    expect(prefs.find((p) => p.type === TYPE)?.emailEnabled).toBe(false);
  });
});

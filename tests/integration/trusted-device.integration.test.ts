// @vitest-environment node
/**
 * The revocation half of "ask for the code once a day".
 *
 * The browser-facing behaviour lives in tests/e2e/two-fa-once-per-day.spec.ts. What matters
 * here is the wiring that is easy to get wrong and impossible to see: every path that kills a
 * user's sessions must also kill the browsers they were remembered on. Miss it and a
 * deactivated or demoted user still walks past 2FA on a machine they once used — their
 * sessions dead, but their trust outliving them.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, Role, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { revokeAllUserSessions } = await import("@/server/auth/session");
const { revokeTrustedDevices } = await import("@/server/auth/trusted-device");

const prisma = new PrismaClient();
const EMAIL = "int.trusted@proitbridge.local";
let userId = "";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Register a live remembered browser for the user and hand back its raw token. */
async function addDevice(): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.trustedDevice.create({
    data: { userId, tokenHash: hash(raw), expiresAt: new Date(Date.now() + 24 * 3600_000) },
  });
  return raw;
}

const liveDevices = () => prisma.trustedDevice.count({ where: { userId, revokedAt: null } });

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { status: UserStatus.ACTIVE },
    create: {
      email: EMAIL, name: "Integration Trusted", mobile: "9000000123",
      passwordHash: await bcrypt.hash("Test#Trust1", 10), role: Role.FINANCE_REVIEWER,
      status: UserStatus.ACTIVE, mustChangePassword: false, twoFaEnabled: true,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.trustedDevice.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.securityEvent.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("revoking sessions also revokes remembered browsers", () => {
  it("revokeAllUserSessions drops every live device (password/role change, deactivation)", async () => {
    await prisma.trustedDevice.deleteMany({ where: { userId } });
    await addDevice();
    await addDevice();
    expect(await liveDevices()).toBe(2);

    await revokeAllUserSessions(userId);

    expect(await liveDevices(), "no browser may stay trusted once sessions are revoked").toBe(0);
  });

  it("revocation is a soft mark, never a delete (BR-21 — history survives)", async () => {
    await prisma.trustedDevice.deleteMany({ where: { userId } });
    await addDevice();
    await revokeTrustedDevices(userId);

    const rows = await prisma.trustedDevice.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).not.toBeNull();
  });

  it("stores only the hash, so a leaked row cannot be replayed as a cookie", async () => {
    await prisma.trustedDevice.deleteMany({ where: { userId } });
    const raw = await addDevice();
    const row = await prisma.trustedDevice.findFirstOrThrow({ where: { userId } });
    expect(row.tokenHash).not.toBe(raw);
    expect(row.tokenHash).toBe(hash(raw));
  });

  it("leaves other users' devices alone", async () => {
    await prisma.trustedDevice.deleteMany({ where: { userId } });
    const other = await prisma.user.findFirstOrThrow({ where: { email: "rajesh@proitbridge.local" } });
    const otherDevice = await prisma.trustedDevice.create({
      data: { userId: other.id, tokenHash: hash(randomBytes(32).toString("hex")), expiresAt: new Date(Date.now() + 3600_000) },
    });

    await addDevice();
    await revokeAllUserSessions(userId);

    const untouched = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: otherDevice.id } });
    expect(untouched.revokedAt).toBeNull();
    await prisma.trustedDevice.delete({ where: { id: otherDevice.id } });
  });
});

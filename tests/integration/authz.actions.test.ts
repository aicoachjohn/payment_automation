// @vitest-environment node
/**
 * Phase 2 verify #2 & #3 — server-side authorization on real server actions,
 * invoked DIRECTLY (bypassing the UI). We mock only the request-scoped Next APIs
 * (cookies/headers/cache); everything else — getSession, the permission guards, the
 * services, Prisma — is the real code path.
 *
 *  #2: a SALESPERSON calling a `payment:audit`-guarded action is rejected server-side.
 *  #3: a FINANCE_REVIEWER is refused by EVERY exported write action (enumerated).
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { PrismaClient, Role, UserStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

// A single mutable cookie jar shared between the mock and the test's loginAs().
const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (cookieJar.has(k) ? { name: k, value: cookieJar.get(k) } : undefined),
    set: (k: string, v: string) => cookieJar.set(k, v),
    delete: (k: string) => cookieJar.delete(k),
  }),
  headers: async () => new Headers(),
}));
// revalidatePath throws outside a request; no-op it so the allowed path can run.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Imported AFTER the mocks so the modules pick them up.
const { signSessionCookie, SESSION_COOKIE } = await import("@/server/auth/cookie");
const { withPermission } = await import("@/server/safe-action");
const {
  createUserAction,
  updateUserRoleAction,
  deactivateUserAction,
  reactivateUserAction,
} = await import("@/app/(superadmin)/admin/users/actions");

const prisma = new PrismaClient();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const AUTHZ_MESSAGE = "You do not have permission to perform this action.";

const users: Record<string, string> = {};
async function makeUser(email: string, role: Role): Promise<string> {
  const u = await prisma.user.upsert({
    where: { email },
    update: { role, status: UserStatus.ACTIVE, mustChangePassword: false },
    create: {
      email, name: `authz ${role}`, mobile: "9000000000", passwordHash: "x",
      role, status: UserStatus.ACTIVE, mustChangePassword: false, twoFaEnabled: true,
    },
  });
  return u.id;
}

/** Establish a real, 2FA-verified session for a role and set the signed cookie. */
async function loginAs(userId: string, role: Role): Promise<void> {
  const raw = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId, tokenHash: sha256(raw), twoFaVerified: true,
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  cookieJar.set(SESSION_COOKIE, await signSessionCookie({ sid: raw, role }));
}

beforeAll(async () => {
  users.finance = await makeUser("authz.finance@proitbridge.local", Role.FINANCE_REVIEWER);
  users.sales = await makeUser("authz.sales@proitbridge.local", Role.SALESPERSON);
  users.admin = await makeUser("authz.admin@proitbridge.local", Role.SUPER_ADMIN);
});

afterAll(async () => {
  for (const id of Object.values(users)) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }
  await prisma.user.deleteMany({
    where: { email: { in: [
      "authz.finance@proitbridge.local", "authz.sales@proitbridge.local",
      "authz.admin@proitbridge.local", "authz.created@proitbridge.local",
    ] } },
  });
  await prisma.$disconnect();
});

// Every exported WRITE server action, as a thunk with valid-shape input.
const WRITE_ACTIONS: { name: string; call: () => Promise<{ serverError?: string } | undefined> }[] = [
  { name: "createUserAction", call: () => createUserAction({ name: "X", email: "authz.created@proitbridge.local", mobile: "9999999999", role: Role.SALESPERSON, isBreakGlass: false }) },
  { name: "updateUserRoleAction", call: () => updateUserRoleAction({ userId: users.sales, role: Role.SALES_MANAGER }) },
  { name: "deactivateUserAction", call: () => deactivateUserAction({ userId: users.sales }) },
  { name: "reactivateUserAction", call: () => reactivateUserAction({ userId: users.sales }) },
];

describe("#3 — FINANCE_REVIEWER is refused by every write action (BR-18)", () => {
  beforeAll(async () => {
    cookieJar.clear();
    await loginAs(users.finance, Role.FINANCE_REVIEWER);
  });

  for (const action of WRITE_ACTIONS) {
    it(`${action.name} → refused server-side`, async () => {
      const res = await action.call();
      expect(res?.serverError).toBe(AUTHZ_MESSAGE);
    });
  }

  it("and no user was actually created by the refused createUserAction", async () => {
    const created = await prisma.user.findUnique({ where: { email: "authz.created@proitbridge.local" } });
    expect(created).toBeNull();
  });
});

describe("#2 — a SALESPERSON calling a payment:audit action is rejected server-side", () => {
  it("refuses the salesperson", async () => {
    cookieJar.clear();
    await loginAs(users.sales, Role.SALESPERSON);
    // The exact guard the Phase-7 audit decision action will use.
    const auditAction = withPermission("payment:audit")
      .schema(z.object({ paymentId: z.string() }))
      .action(async () => ({ ok: true as const }));
    const res = await auditAction({ paymentId: "p_123" });
    expect(res?.serverError).toBe(AUTHZ_MESSAGE);
  });
});

describe("positive control — the permitted role IS allowed (guard is not blanket-deny)", () => {
  it("SUPER_ADMIN createUserAction succeeds", async () => {
    cookieJar.clear();
    await loginAs(users.admin, Role.SUPER_ADMIN);
    const res = await createUserAction({
      name: "Created By Admin", email: "authz.created@proitbridge.local",
      mobile: "9999999999", role: Role.SALESPERSON, isBreakGlass: false,
    });
    expect(res?.serverError).toBeUndefined();
    expect(res?.data).toEqual({ ok: true });
    const created = await prisma.user.findUnique({ where: { email: "authz.created@proitbridge.local" } });
    expect(created).not.toBeNull();
  });
});

import { PrismaClient, Role, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { loadEnv } from "./env";

loadEnv();

export const prisma = new PrismaClient();

export interface E2EUser {
  email: string;
  password: string;
  role: Role;
  twoFa: boolean;
  isBreakGlass?: boolean;
}

export const E2E = {
  sales: { email: "e2e.sales@proitbridge.local", password: "Test#Sales1", role: Role.SALESPERSON, twoFa: false },
  lock: { email: "e2e.lock@proitbridge.local", password: "Test#Lock1", role: Role.SALESPERSON, twoFa: false },
  finance: { email: "e2e.finance@proitbridge.local", password: "Test#Fin1", role: Role.FINANCE_REVIEWER, twoFa: true },
  bgadmin: { email: "e2e.bgadmin@proitbridge.local", password: "Test#Admin1", role: Role.SUPER_ADMIN, twoFa: true, isBreakGlass: true },
} satisfies Record<string, E2EUser>;

/** Create/reset an e2e user with a known password and no forced first-login change. */
export async function ensureUser(u: E2EUser): Promise<string> {
  const passwordHash = await bcrypt.hash(u.password, 10);
  const data = {
    name: `E2E ${u.role}`,
    mobile: "9000000000",
    passwordHash,
    role: u.role,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    twoFaEnabled: u.twoFa,
    isBreakGlass: u.isBreakGlass ?? false,
    failedLoginCount: 0,
    lockedUntil: null,
  };
  const user = await prisma.user.upsert({
    where: { email: u.email },
    update: data,
    create: { email: u.email, ...data },
  });
  // Start each run from a clean session slate.
  await prisma.session.deleteMany({ where: { userId: user.id } });
  return user.id;
}

export async function cleanupUser(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.securityEvent.deleteMany({ where: { userId: user.id } });
  await prisma.notification.deleteMany({ where: { recipientId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

/**
 * Page/layout guards (server components). These re-verify the session on the server for
 * every render — the UI is never the control (FR-SEC-02/03, NFR-07). Cross-role direct
 * navigation is blocked by middleware with a 403; these guards are defence-in-depth and
 * handle the in-app flows (unauthenticated → login, 2FA pending → OTP, forced password
 * change → change-password).
 */
import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSession, type SessionContext } from "@/server/auth/session";
import { ROLE_HOME } from "@/server/auth/permissions";

export async function requireAuth(): Promise<SessionContext> {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  if (!ctx.session.twoFaVerified) redirect("/login/otp");
  if (ctx.user.mustChangePassword) redirect("/change-password");
  return ctx;
}

export async function requireRoles(allowed: Role[]): Promise<SessionContext> {
  const ctx = await requireAuth();
  if (!allowed.includes(ctx.user.role)) {
    redirect(ROLE_HOME[ctx.user.role]);
  }
  return ctx;
}

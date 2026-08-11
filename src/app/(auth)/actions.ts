"use server";

import { headers } from "next/headers";
import { actionClient, sessionActionClient } from "@/server/safe-action";
import { rateLimit } from "@/server/auth/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import {
  loginSchema,
  otpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "@/lib/schemas";
import {
  login,
  verifyOtp,
  logout,
  requestPasswordReset,
  resetPassword,
  changePassword,
} from "@/server/services/auth";

async function reqCtx(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { ip, userAgent: h.get("user-agent") };
}

const RATE_LIMITED = "Too many attempts. Please wait a minute and try again.";

export const loginAction = actionClient
  .schema(loginSchema)
  .action(async ({ parsedInput }) => {
    const ctx = await reqCtx();
    if (!rateLimit(`login:${ctx.ip ?? "unknown"}`, RATE_LIMITS.login).allowed) {
      return { ok: false as const, error: RATE_LIMITED };
    }
    return login(parsedInput.email, parsedInput.password, ctx);
  });

export const verifyOtpAction = actionClient
  .schema(otpSchema)
  .action(async ({ parsedInput }) => {
    const ctx = await reqCtx();
    if (!rateLimit(`otp:${ctx.ip ?? "unknown"}`, RATE_LIMITS.otp).allowed) {
      return { ok: false as const, error: RATE_LIMITED };
    }
    return verifyOtp(parsedInput.code, ctx);
  });

export const forgotPasswordAction = actionClient
  .schema(forgotPasswordSchema)
  .action(async ({ parsedInput }) => {
    const ctx = await reqCtx();
    if (rateLimit(`forgot:${ctx.ip ?? "unknown"}`, RATE_LIMITS.forgotPassword).allowed) {
      await requestPasswordReset(parsedInput.email, ctx);
    }
    // Identical response whether or not the email exists (anti-enumeration).
    return {
      ok: true as const,
      message:
        "If an account exists for that email, a password reset link has been sent.",
    };
  });

export const resetPasswordAction = actionClient
  .schema(resetPasswordSchema)
  .action(async ({ parsedInput }) => {
    const ctx = await reqCtx();
    return resetPassword(parsedInput.token, parsedInput.newPassword, ctx);
  });

export const changePasswordAction = sessionActionClient
  .schema(changePasswordSchema)
  .action(async ({ parsedInput, ctx }) => {
    const reqctx = await reqCtx();
    return changePassword(ctx.actor.userId, parsedInput.newPassword, {
      ...reqctx,
      currentPassword: parsedInput.currentPassword,
    });
  });

export const logoutAction = sessionActionClient.action(async ({ ctx }) => {
  const reqctx = await reqCtx();
  await logout(ctx.actor.userId, reqctx);
  return { ok: true as const };
});

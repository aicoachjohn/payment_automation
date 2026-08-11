/**
 * next-safe-action clients — the thin-edge contract: validate (Zod) → authenticate →
 * authorise → call service. Errors are sanitised so no stack trace, SQL, path or
 * internal id ever reaches the client (NFR-11, FR-SEC-30). Deny-by-default: the
 * authenticated clients reject unless a valid, 2FA-verified session is present.
 */
import "server-only";
import { createSafeActionClient } from "next-safe-action";
import { getSession } from "@/server/auth/session";
import {
  AuthorizationError,
  requirePermission,
  type Permission,
} from "@/server/auth/permissions";
import { UserServiceError } from "@/server/services/users";

/** A safe, intentional, user-facing error thrown by actions/services. */
export class ActionError extends Error {}

const DEFAULT_ERROR = "Something went wrong. Please try again.";

export const actionClient = createSafeActionClient({
  handleServerError(error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof ActionError ||
      error instanceof UserServiceError
    ) {
      return error.message;
    }
    // Log server-side; return a generic message to the client.
    console.error("[action error]", error);
    return DEFAULT_ERROR;
  },
});

/** Requires a signed-in, 2FA-verified session (allows mustChangePassword — used by the
 *  change-password and logout actions). */
export const sessionActionClient = actionClient.use(async ({ next }) => {
  const ctx = await getSession();
  if (!ctx) throw new AuthorizationError("Please sign in to continue.");
  if (!ctx.session.twoFaVerified) {
    throw new AuthorizationError("Two-factor verification is required.");
  }
  return next({ ctx: { actor: ctx.actor, user: ctx.user } });
});

/** Requires a fully-authenticated session (2FA done AND password not pending change). */
export const authActionClient = sessionActionClient.use(async ({ ctx, next }) => {
  if (ctx.user.mustChangePassword) {
    throw new AuthorizationError("You must change your password before continuing.");
  }
  return next({ ctx });
});

/** Authenticated client that also requires a specific permission (FR-SEC-02/03). */
export function withPermission(permission: Permission) {
  return authActionClient.use(async ({ ctx, next }) => {
    requirePermission(ctx.actor, permission);
    return next({ ctx });
  });
}

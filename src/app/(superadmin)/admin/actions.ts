"use server";

import { revalidatePath } from "next/cache";
import { authActionClient, withPermission } from "@/server/safe-action";
import { overrideInputSchema, configSetSchema, recordSearchSchema } from "@/lib/schemas";
import { performOverride, describeOverride, OverrideError, type OverrideInput } from "@/server/services/overrides";
import { setConfig } from "@/server/services/system-config";
import { findRecords } from "@/server/services/admin-console";
import { runDailyAutomation } from "@/server/services/automation";
import { runReconciliation, acknowledgeException, resolveException, ReconciliationError } from "@/server/services/reconciliation";
import { AuthorizationError } from "@/server/auth/permissions";
import { z } from "zod";

/**
 * Super Admin console actions. Every override routes through the ONE performOverride()
 * service, which enforces the mandatory reason, writes the SuperAdminActivity + AuditTrail
 * entries and notifies the affected role. None of these can edit a payment amount, date
 * or Transaction ID — that capability does not exist (FR-SA-08, BR-24).
 */

function safe(e: unknown): { ok: false; error: string } {
  if (e instanceof OverrideError || e instanceof AuthorizationError) return { ok: false as const, error: e.message };
  throw e;
}

/** Preview the exact consequence of an override for the confirmation dialog (FR-SA-15). */
export const describeOverrideAction = authActionClient
  .schema(overrideInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const summary = await describeOverride(ctx.actor, parsedInput as OverrideInput);
      return { ok: true as const, summary };
    } catch (e) {
      return safe(e);
    }
  });

/** Commit an override (SUPER_ADMIN only; the service enforces role + per-kind permission). */
export const performOverrideAction = authActionClient
  .schema(overrideInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const { activityId } = await performOverride(ctx.actor, parsedInput as OverrideInput);
      revalidatePath("/admin");
      revalidatePath("/admin/overrides");
      revalidatePath("/admin/activity");
      return { ok: true as const, activityId };
    } catch (e) {
      return safe(e);
    }
  });

/** Set a system-configuration value (audited). Super Admin only. */
export const setConfigAction = withPermission("config:write")
  .schema(configSetSchema)
  .action(async ({ parsedInput, ctx }) => {
    // The form sends a raw string; store JSON when it parses, otherwise the string.
    let value: unknown = parsedInput.value;
    try {
      value = JSON.parse(parsedInput.value);
    } catch {
      /* keep as string */
    }
    await setConfig(ctx.actor, parsedInput.key, value, parsedInput.description);
    revalidatePath("/admin/settings");
    return { ok: true as const };
  });

/** Run the daily automation tick now (reminders, deadline transfers, nudges). Idempotent. */
export const runAutomationAction = withPermission("config:write")
  .schema(z.object({}))
  .action(async () => {
    const summary = await runDailyAutomation(new Date());
    revalidatePath("/admin/jobs");
    return { ok: true as const, summary };
  });

/** Run the daily reconciliation check now (FR-REC-11). Raises exceptions to SA + Rajesh. */
export const runReconciliationAction = withPermission("config:write")
  .schema(z.object({}))
  .action(async ({ ctx }) => {
    const result = await runReconciliation(ctx.actor);
    revalidatePath("/admin/reconciliation");
    return { ok: true as const, checked: result.checked, exceptionsRaised: result.exceptionsRaised };
  });

export const acknowledgeExceptionAction = authActionClient
  .schema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    await acknowledgeException(ctx.actor, parsedInput.id);
    revalidatePath("/admin/reconciliation");
    return { ok: true as const };
  });

export const resolveExceptionAction = withPermission("config:write")
  .schema(z.object({ id: z.string().min(1), note: z.string().trim().min(1, "A resolution note is required.") }))
  .action(async ({ parsedInput, ctx }) => {
    try {
      await resolveException(ctx.actor, parsedInput.id, parsedInput.note);
      revalidatePath("/admin/reconciliation");
      return { ok: true as const };
    } catch (e) {
      if (e instanceof ReconciliationError) return { ok: false as const, error: e.message };
      throw e;
    }
  });

/** Search leads/payments for the record browser (FR-SA-03). Read-only. */
export const searchRecordsAction = authActionClient
  .schema(recordSearchSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const results = await findRecords(ctx.actor, parsedInput.query);
      return { ok: true as const, ...results };
    } catch (e) {
      return safe(e);
    }
  });

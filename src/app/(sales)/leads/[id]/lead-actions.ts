"use server";

import { revalidatePath } from "next/cache";
import { authActionClient } from "@/server/safe-action";
import { followUpCreateSchema, taskIdSchema, handoverEnrollmentSchema } from "@/lib/schemas";
import { createFollowUp, completeFollowUp, FollowUpError } from "@/server/services/follow-ups";
import { submitToDataMgmt, HandoverError } from "@/server/services/handover";
import { AuthorizationError } from "@/server/auth/permissions";

function safe(e: unknown): { ok: false; error: string } {
  if (e instanceof FollowUpError || e instanceof HandoverError || e instanceof AuthorizationError) return { ok: false as const, error: e.message };
  throw e;
}

export const createFollowUpAction = authActionClient
  .schema(followUpCreateSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      await createFollowUp(ctx.actor, parsedInput);
      revalidatePath(`/leads/${parsedInput.leadId}`);
      return { ok: true as const };
    } catch (e) {
      return safe(e);
    }
  });

export const completeFollowUpAction = authActionClient
  .schema(taskIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      await completeFollowUp(ctx.actor, parsedInput.taskId);
      revalidatePath("/sales");
      return { ok: true as const };
    } catch (e) {
      return safe(e);
    }
  });

/** Stage 1 of the handover chain: Sales submit the record to Data Management for approval. */
export const performHandoverAction = authActionClient
  .schema(handoverEnrollmentSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const res = await submitToDataMgmt(ctx.actor, parsedInput.enrollmentId);
      revalidatePath("/sales");
      return { ok: true as const, message: res.message, handoverId: res.handoverId };
    } catch (e) {
      return safe(e);
    }
  });

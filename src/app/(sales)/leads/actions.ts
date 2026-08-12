"use server";

import { revalidatePath } from "next/cache";
import { authActionClient, withPermission } from "@/server/safe-action";
import {
  leadCreateSchema,
  basicDetailsSchema,
  courseSelectionWithLeadSchema,
  duplicateCheckSchema,
  leadIdSchema,
  concessionRequestSchema,
  concessionDecisionSchema,
} from "@/lib/schemas";
import {
  createLead,
  updateBasicDetails,
  markInterested,
  selectCourse,
  requestConcession,
  decideConcession,
  checkDuplicate,
} from "@/server/services/leads";

export const createLeadAction = authActionClient
  .schema(leadCreateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id } = await createLead(ctx.actor, parsedInput);
    revalidatePath("/sales");
    return { ok: true as const, leadId: id };
  });

export const checkDuplicateAction = authActionClient
  .schema(duplicateCheckSchema)
  .action(async ({ parsedInput }) => {
    const hit = await checkDuplicate(parsedInput.field, parsedInput.value);
    return { duplicate: hit };
  });

export const updateBasicDetailsAction = authActionClient
  .schema(leadIdSchema.merge(basicDetailsSchema))
  .action(async ({ parsedInput, ctx }) => {
    const { leadId, ...data } = parsedInput;
    await updateBasicDetails(ctx.actor, leadId, data);
    revalidatePath(`/leads/${leadId}`);
    return { ok: true as const };
  });

export const markInterestedAction = authActionClient
  .schema(leadIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await markInterested(ctx.actor, parsedInput.leadId);
    revalidatePath(`/leads/${parsedInput.leadId}`);
    return { ok: true as const };
  });

export const selectCourseAction = authActionClient
  .schema(courseSelectionWithLeadSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { leadId, ...sel } = parsedInput;
    await selectCourse(ctx.actor, leadId, sel);
    revalidatePath(`/leads/${leadId}`);
    return { ok: true as const };
  });

export const requestConcessionAction = authActionClient
  .schema(concessionRequestSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { leadId, concessionType, concessionValue, reason } = parsedInput;
    const res = await requestConcession(ctx.actor, leadId, { concessionType, concessionValue, reason });
    revalidatePath(`/leads/${leadId}`);
    return { ok: true as const, status: res.status };
  });

export const decideConcessionAction = withPermission("concession:approve")
  .schema(concessionDecisionSchema)
  .action(async ({ parsedInput, ctx }) => {
    await decideConcession(ctx.actor, parsedInput.leadId, parsedInput.decision, parsedInput.reason);
    revalidatePath(`/leads/${parsedInput.leadId}`);
    revalidatePath("/sales");
    return { ok: true as const };
  });

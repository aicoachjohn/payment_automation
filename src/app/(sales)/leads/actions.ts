"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { authActionClient, withPermission } from "@/server/safe-action";
import { AuthorizationError } from "@/server/auth/permissions";
import {
  leadCreateSchema,
  leadAutofillTextSchema,
  basicDetailsSchema,
  courseSelectionWithLeadSchema,
  duplicateCheckSchema,
  leadIdSchema,
  concessionRequestSchema,
  concessionDecisionSchema,
  intakeInviteSchema,
  voidLeadSchema,
} from "@/lib/schemas";
import { createIntakeInvite } from "@/server/services/lead-intake-link";
import {
  createLead,
  updateBasicDetails,
  markInterested,
  selectCourse,
  requestConcession,
  decideConcession,
  checkDuplicate,
  voidLead,
} from "@/server/services/leads";
import { extractLeadFromText, extractLeadFromUpload, LeadIntakeError } from "@/server/services/lead-intake";
import { generateDraft } from "@/server/services/draft";

export const createLeadAction = authActionClient
  .schema(leadCreateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id } = await createLead(ctx.actor, parsedInput);
    revalidatePath("/sales");
    return { ok: true as const, leadId: id };
  });

/** Auto-fill from pasted text (WhatsApp message / enquiry note). */
export const autofillLeadFromTextAction = authActionClient
  .schema(leadAutofillTextSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = extractLeadFromText(ctx.actor, parsedInput.text);
    return { ok: result.ok, fields: result.fields };
  });

/** Auto-fill from an uploaded screenshot / document (multipart → OCR). */
export async function autofillLeadFromFileAction(formData: FormData) {
  try {
    const ctx = await getSession();
    if (!ctx || !ctx.session.twoFaVerified || ctx.user.mustChangePassword) {
      throw new AuthorizationError("Please sign in to continue.");
    }
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "No file was provided." as string };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await extractLeadFromUpload(ctx.actor, { bytes, originalFilename: file.name });
    return { ok: result.ok, fields: result.fields };
  } catch (e) {
    if (e instanceof LeadIntakeError || e instanceof AuthorizationError) return { error: e.message };
    console.error("[lead autofill error]", e);
    return { error: "Could not read that file. Please try another, or enter the details manually." };
  }
}

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

export const generateDraftAction = authActionClient
  .schema(leadIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const draft = await generateDraft(ctx.actor, parsedInput.leadId);
    revalidatePath(`/leads/${parsedInput.leadId}`);
    return { ok: true as const, ...draft };
  });

/** Remove (void) a lead the salesperson added — soft delete with a reason (BR-21/BR-26). */
export const voidLeadAction = authActionClient
  .schema(voidLeadSchema)
  .action(async ({ parsedInput, ctx }) => {
    await voidLead(ctx.actor, parsedInput.leadId, parsedInput.reason);
    revalidatePath("/sales");
    revalidatePath(`/leads/${parsedInput.leadId}`);
    return { ok: true as const };
  });

/** Mint a single-use, 7-day self-intake link the salesperson shares with a prospective lead. */
export const createIntakeInviteAction = authActionClient
  .schema(intakeInviteSchema)
  .action(async ({ parsedInput, ctx }) => {
    const invite = await createIntakeInvite(ctx.actor, parsedInput.note);
    return { ok: true as const, url: invite.url, expiresAt: invite.expiresAt.toISOString() };
  });

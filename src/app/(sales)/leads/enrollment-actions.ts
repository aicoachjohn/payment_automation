"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { authActionClient } from "@/server/safe-action";
import { AuthorizationError } from "@/server/auth/permissions";
import { reviewedBundleSchema, applyBundleSchema } from "@/lib/schemas";
import {
  extractEnrollmentBundle,
  commitEnrollmentBundle,
  applyEnrollmentBundle,
  EnrollmentIntakeError,
} from "@/server/services/enrollment-intake";
import { PaymentError } from "@/server/services/payments";
import { LeadError } from "@/server/services/leads";
import { DraftError } from "@/server/services/draft";
import { PricingError } from "@/server/services/pricing";

async function actorOrThrow() {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified || ctx.user.mustChangePassword) {
    throw new AuthorizationError("Please sign in to continue.");
  }
  return ctx.actor;
}

/** Errors with a safe, user-facing message; anything else is logged and generalised. */
function safeMessage(e: unknown): string {
  if (
    e instanceof EnrollmentIntakeError ||
    e instanceof PaymentError ||
    e instanceof LeadError ||
    e instanceof DraftError ||
    e instanceof PricingError ||
    e instanceof AuthorizationError
  ) {
    return e.message;
  }
  console.error("[enrollment intake action error]", e);
  return "Something went wrong. Please try again.";
}

const MAX_PROOFS = 8;

/**
 * Multipart extract: the pasted `text` + up to MAX_PROOFS proof `file`s → an assistive,
 * pre-filled preview (learner, program/fee, one payment per proof). No lead/payment is
 * created; proofs are staged (validated/scanned/stored/OCR'd) and posted back on confirm.
 */
export async function extractEnrollmentBundleAction(formData: FormData) {
  try {
    const actor = await actorOrThrow();
    const text = String(formData.get("text") ?? "");
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);
    if (!text.trim() && files.length === 0) {
      return { error: "Paste the enrollment message or add a proof to continue." as string };
    }
    if (files.length > MAX_PROOFS) {
      return { error: `Please add at most ${MAX_PROOFS} proofs at a time.` as string };
    }
    const proofs = await Promise.all(
      files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), originalFilename: f.name })),
    );
    const preview = await extractEnrollmentBundle(actor, { text, proofs });
    return { ok: true as const, preview };
  } catch (e) {
    return { error: safeMessage(e) };
  }
}

/** Commit the reviewed + confirmed bundle → Lead + Enrollment + one Payment per proof. */
export const commitEnrollmentBundleAction = authActionClient
  .schema(reviewedBundleSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = await commitEnrollmentBundle(ctx.actor, parsedInput);
    revalidatePath("/sales");
    revalidatePath(`/leads/${result.leadId}`);
    return { ok: true as const, ...result };
  });

/** Apply the reviewed bundle to an EXISTING lead (lead-page "Auto-fill from uploads"). */
export const applyEnrollmentBundleAction = authActionClient
  .schema(applyBundleSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { leadId, ...bundle } = parsedInput;
    const result = await applyEnrollmentBundle(ctx.actor, leadId, bundle);
    revalidatePath("/sales");
    revalidatePath(`/leads/${leadId}`);
    return { ok: true as const, ...result };
  });

"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { authActionClient } from "@/server/safe-action";
import { AuthorizationError } from "@/server/auth/permissions";
import { capturePaymentSchema, proofIdSchema } from "@/lib/schemas";
import {
  uploadProof,
  capturePayment,
  issueProofUrl,
  replaceProof,
  PaymentError,
} from "@/server/services/payments";

async function actorOrThrow() {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified || ctx.user.mustChangePassword) {
    throw new AuthorizationError("Please sign in to continue.");
  }
  return ctx.actor;
}

function safeMessage(e: unknown): string {
  if (e instanceof PaymentError || e instanceof AuthorizationError) return e.message;
  console.error("[payment action error]", e);
  return "Something went wrong. Please try again.";
}

/** Multipart upload → validate/scan/store/OCR. Returns the staged proof + OCR fields. */
export async function uploadProofAction(formData: FormData) {
  try {
    const actor = await actorOrThrow();
    const leadId = String(formData.get("leadId") ?? "");
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "No file was provided." as string };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const proof = await uploadProof(actor, leadId, { bytes, originalFilename: file.name });
    return { ok: true as const, proof };
  } catch (e) {
    return { error: safeMessage(e) };
  }
}

export async function replaceProofAction(formData: FormData) {
  try {
    const actor = await actorOrThrow();
    const paymentId = String(formData.get("paymentId") ?? "");
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "No file was provided." as string };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await replaceProof(actor, paymentId, { bytes, originalFilename: file.name });
    return { ok: true as const, version: result.version };
  } catch (e) {
    return { error: safeMessage(e) };
  }
}

export const capturePaymentAction = authActionClient
  .schema(capturePaymentSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { leadId, ...rest } = parsedInput;
    const result = await capturePayment(ctx.actor, leadId, rest);
    revalidatePath(`/leads/${leadId}`);
    return { ok: true as const, ...result };
  });

export const requestProofUrlAction = authActionClient
  .schema(proofIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const url = await issueProofUrl(ctx.actor, parsedInput.proofId);
    return { ok: true as const, url };
  });

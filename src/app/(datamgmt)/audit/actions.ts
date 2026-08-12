"use server";

import { revalidatePath } from "next/cache";
import { withPermission } from "@/server/safe-action";
import {
  approvePaymentSchema,
  auditDecisionSchema,
  bulkApproveSchema,
} from "@/lib/schemas";
import {
  approvePayment,
  requestCorrection,
  rejectPayment,
  bulkApprove,
} from "@/server/services/audit-decisions";

// Every action requires `payment:audit` — DATA_MGMT_AUDITOR only (BR-15).
const audit = withPermission("payment:audit");

export const approvePaymentAction = audit
  .schema(approvePaymentSchema)
  .action(async ({ parsedInput, ctx }) => {
    await approvePayment(ctx.actor, parsedInput.paymentId, {
      confirmations: parsedInput.confirmations,
      varianceReason: parsedInput.varianceReason,
    });
    revalidatePath("/audit");
    revalidatePath(`/audit/${parsedInput.paymentId}`);
    return { ok: true as const };
  });

export const requestCorrectionAction = audit
  .schema(auditDecisionSchema)
  .action(async ({ parsedInput, ctx }) => {
    await requestCorrection(ctx.actor, parsedInput.paymentId, { reasonCode: parsedInput.reasonCode, comment: parsedInput.comment });
    revalidatePath("/audit");
    return { ok: true as const };
  });

export const rejectPaymentAction = audit
  .schema(auditDecisionSchema)
  .action(async ({ parsedInput, ctx }) => {
    await rejectPayment(ctx.actor, parsedInput.paymentId, { reasonCode: parsedInput.reasonCode, comment: parsedInput.comment });
    revalidatePath("/audit");
    return { ok: true as const };
  });

export const bulkApproveAction = audit
  .schema(bulkApproveSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = await bulkApprove(ctx.actor, parsedInput.paymentIds);
    revalidatePath("/audit");
    return { ok: true as const, ...result };
  });

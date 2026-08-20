"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient } from "@/server/safe-action";
import {
  submitToFinance,
  financeApproveHandover,
  financeRejectHandover,
  HandoverError,
} from "@/server/services/handover";

/**
 * Stage 2 of the handover chain: Data Management pass an approved record to Finance.
 * Guarded server-side in the service (DATA_MGMT_AUDITOR only) — this is only the edge.
 */
export const submitToFinanceAction = authActionClient
  .schema(z.object({ handoverId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    try {
      const res = await submitToFinance(ctx.actor, parsedInput.handoverId);
      revalidatePath(`/handover/${parsedInput.handoverId}`);
      revalidatePath("/handover");
      // Each role acts from its OWN screen, not the handover tab: Nandhiya from the audit
      // record, Rajesh from his dashboard. Both must refresh or the decision appears only on
      // a page neither of them visits.
      revalidatePath("/audit", "layout");
      revalidatePath("/finance");
      return { ok: true as const, message: res.message };
    } catch (e) {
      if (e instanceof HandoverError) return { ok: false as const, error: e.message };
      throw e;
    }
  });

/** Stage 3: Finance's second-level sign-off. Scoped to the handover — never payment data. */
export const financeApproveAction = authActionClient
  .schema(z.object({ handoverId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    try {
      const res = await financeApproveHandover(ctx.actor, parsedInput.handoverId);
      revalidatePath(`/handover/${parsedInput.handoverId}`);
      revalidatePath("/handover");
      // Each role acts from its OWN screen, not the handover tab: Nandhiya from the audit
      // record, Rajesh from his dashboard. Both must refresh or the decision appears only on
      // a page neither of them visits.
      revalidatePath("/audit", "layout");
      revalidatePath("/finance");
      return { ok: true as const, message: res.message };
    } catch (e) {
      if (e instanceof HandoverError) return { ok: false as const, error: e.message };
      throw e;
    }
  });

/** Finance sends it back to Data Management. The reason is mandatory (BR-16). */
export const financeRejectAction = authActionClient
  .schema(z.object({ handoverId: z.string().min(1), reason: z.string().trim().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    try {
      const res = await financeRejectHandover(ctx.actor, parsedInput.handoverId, parsedInput.reason);
      revalidatePath(`/handover/${parsedInput.handoverId}`);
      revalidatePath("/handover");
      // Each role acts from its OWN screen, not the handover tab: Nandhiya from the audit
      // record, Rajesh from his dashboard. Both must refresh or the decision appears only on
      // a page neither of them visits.
      revalidatePath("/audit", "layout");
      revalidatePath("/finance");
      return { ok: true as const, message: res.message };
    } catch (e) {
      if (e instanceof HandoverError) return { ok: false as const, error: e.message };
      throw e;
    }
  });

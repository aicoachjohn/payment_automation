"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient } from "@/server/safe-action";
import { submitToFinance, HandoverError } from "@/server/services/handover";

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
      return { ok: true as const, message: res.message };
    } catch (e) {
      if (e instanceof HandoverError) return { ok: false as const, error: e.message };
      throw e;
    }
  });

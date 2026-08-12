"use server";

/**
 * Fee calculation action used by the sales lead form (Phase 4) and the admin fee
 * preview. The input is SELECTIONS ONLY — a strict Zod schema rejects any hand-typed
 * fee (FR-SAL-20, BR-01). The server computes and returns the fee; the browser never
 * supplies a rupee figure. (`_actions` is a Next private folder, not a route.)
 */
import { authActionClient } from "@/server/safe-action";
import { feeCalcSchema } from "@/lib/schemas";
import { calculateFee, PricingError } from "@/server/services/pricing";
import { ActionError } from "@/server/safe-action";

export const calculateFeeAction = authActionClient
  .schema(feeCalcSchema)
  .action(async ({ parsedInput }) => {
    try {
      const q = await calculateFee({
        program: parsedInput.program,
        plan: parsedInput.plan,
        comboMode: parsedInput.comboMode ?? null,
      });
      return {
        pricingId: q.pricingId,
        standardFee: q.standardFee.toFixed(2),
        baseFee: q.baseFee.toFixed(2),
        gstAmount: q.gstAmount.toFixed(2),
        gstPercent: q.gstPercent.toFixed(2),
      };
    } catch (e) {
      if (e instanceof PricingError) throw new ActionError(e.message);
      throw e;
    }
  });

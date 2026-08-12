"use server";

import { revalidatePath } from "next/cache";
import { withPermission } from "@/server/safe-action";
import {
  pricingInputSchema,
  pricingUpdateSchema,
  pricingIdSchema,
  concessionThresholdSchema,
  reasonCodesSchema,
} from "@/lib/schemas";
import {
  createPricing,
  updatePricing,
  deactivatePricing,
  setConcessionThreshold,
  setReasonCodes,
} from "@/server/services/pricing-admin";

const writePricing = withPermission("pricing:write");
const writeConfig = withPermission("config:write");

export const createPricingAction = writePricing
  .schema(pricingInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await createPricing(ctx.actor, parsedInput);
    revalidatePath("/admin/pricing");
    return { ok: true as const };
  });

export const updatePricingAction = writePricing
  .schema(pricingUpdateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { pricingId, ...input } = parsedInput;
    await updatePricing(ctx.actor, pricingId, input);
    revalidatePath("/admin/pricing");
    return { ok: true as const };
  });

export const deactivatePricingAction = writePricing
  .schema(pricingIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await deactivatePricing(ctx.actor, parsedInput.pricingId);
    revalidatePath("/admin/pricing");
    return { ok: true as const };
  });

export const setThresholdAction = writeConfig
  .schema(concessionThresholdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await setConcessionThreshold(ctx.actor, parsedInput.plan, {
      amount: parsedInput.amount,
      percent: parsedInput.percent,
    });
    revalidatePath("/admin/pricing");
    return { ok: true as const };
  });

export const setReasonCodesAction = writeConfig
  .schema(reasonCodesSchema)
  .action(async ({ parsedInput, ctx }) => {
    await setReasonCodes(ctx.actor, parsedInput.codes);
    revalidatePath("/admin/pricing");
    return { ok: true as const };
  });

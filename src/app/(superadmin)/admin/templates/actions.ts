"use server";

import { revalidatePath } from "next/cache";
import { withPermission } from "@/server/safe-action";
import { draftTemplateSchema } from "@/lib/schemas";
import { setDraftConfig } from "@/server/services/draft";

export const setTemplateAction = withPermission("config:write")
  .schema(draftTemplateSchema)
  .action(async ({ parsedInput, ctx }) => {
    await setDraftConfig(ctx.actor, parsedInput);
    revalidatePath("/admin/templates");
    return { ok: true as const };
  });

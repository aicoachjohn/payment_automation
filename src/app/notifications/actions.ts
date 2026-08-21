"use server";

import { revalidatePath } from "next/cache";
import { sessionActionClient } from "@/server/safe-action";
import { notificationIdSchema } from "@/lib/schemas";
import { markRead, markAllRead } from "@/server/notifications/center";

/** Mark one of the current user's notifications read. */
export const markReadAction = sessionActionClient
  .schema(notificationIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await markRead(ctx.actor, parsedInput.notificationId);
    revalidatePath("/notifications");
    return { ok: true as const };
  });

export const markAllReadAction = sessionActionClient
  .schema(notificationIdSchema.partial())
  .action(async ({ ctx }) => {
    await markAllRead(ctx.actor);
    revalidatePath("/notifications");
    return { ok: true as const };
  });

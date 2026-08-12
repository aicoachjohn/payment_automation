"use server";

import { revalidatePath } from "next/cache";
import { sessionActionClient } from "@/server/safe-action";
import { notificationIdSchema, notificationPrefSchema } from "@/lib/schemas";
import { markRead, markAllRead, setPreference } from "@/server/notifications/center";

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

/** Toggle email delivery for a notification type (in-app is always on). */
export const setPreferenceAction = sessionActionClient
  .schema(notificationPrefSchema)
  .action(async ({ parsedInput, ctx }) => {
    await setPreference(ctx.actor, parsedInput.type, parsedInput.emailEnabled);
    revalidatePath("/notifications");
    return { ok: true as const };
  });

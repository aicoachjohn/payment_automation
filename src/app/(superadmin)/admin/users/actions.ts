"use server";

import { revalidatePath } from "next/cache";
import { UserStatus } from "@prisma/client";
import { withPermission } from "@/server/safe-action";
import {
  createUserSchema,
  updateUserRoleSchema,
  userIdSchema,
} from "@/lib/schemas";
import {
  createUser,
  updateUserRole,
  setUserStatus,
} from "@/server/services/users";

// Every action here requires the `user:manage` permission — i.e. Super Admin only.
const manageUsers = withPermission("user:manage");

export const createUserAction = manageUsers
  .schema(createUserSchema)
  .action(async ({ parsedInput, ctx }) => {
    await createUser(ctx.actor, parsedInput);
    revalidatePath("/admin/users");
    return { ok: true as const };
  });

export const updateUserRoleAction = manageUsers
  .schema(updateUserRoleSchema)
  .action(async ({ parsedInput, ctx }) => {
    await updateUserRole(ctx.actor, parsedInput);
    revalidatePath("/admin/users");
    return { ok: true as const };
  });

export const deactivateUserAction = manageUsers
  .schema(userIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await setUserStatus(ctx.actor, { userId: parsedInput.userId, status: UserStatus.DEACTIVATED });
    revalidatePath("/admin/users");
    return { ok: true as const };
  });

export const reactivateUserAction = manageUsers
  .schema(userIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await setUserStatus(ctx.actor, { userId: parsedInput.userId, status: UserStatus.ACTIVE });
    revalidatePath("/admin/users");
    return { ok: true as const };
  });

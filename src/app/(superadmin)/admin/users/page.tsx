import { requireRoles } from "@/server/auth/guard";
import { Role } from "@prisma/client";
import { listUsers } from "@/server/services/users";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  await requireRoles([Role.SUPER_ADMIN]);
  const users = await listUsers();
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">User management</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Create accounts, assign roles and deactivate users. Users are never deleted —
          only deactivated (BR-21). Exactly one active Super Admin is permitted (BR-23).
        </p>
      </div>
      <UsersClient users={users} />
    </section>
  );
}

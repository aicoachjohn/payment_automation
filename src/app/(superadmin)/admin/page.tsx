import Link from "next/link";
import { requireRoles } from "@/server/auth/guard";
import { Role } from "@prisma/client";

export default async function AdminHome() {
  const { user } = await requireRoles([Role.SUPER_ADMIN]);
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Super Admin Console</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Welcome, {user.name}. Pricing Master, system configuration, the audit-trail
          viewer and override tools arrive in later phases. Available now (Phase 2):
        </p>
      </div>
      <Link
        href="/admin/users"
        className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        User management →
      </Link>
    </section>
  );
}

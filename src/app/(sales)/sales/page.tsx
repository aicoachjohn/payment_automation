import { requireRoles } from "@/server/auth/guard";
import { Role } from "@prisma/client";

export default async function SalesHome() {
  const { user } = await requireRoles([Role.SALESPERSON, Role.SALES_MANAGER]);
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Sales Dashboard</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Welcome, {user.name}. Lead capture, payment drafts and the daily pipeline are
        built in Phases 4&ndash;6. This is the authenticated role shell (Phase 2).
      </p>
    </section>
  );
}

import { requireRoles } from "@/server/auth/guard";
import { Role } from "@prisma/client";

export default async function FinanceHome() {
  const { user } = await requireRoles([Role.FINANCE_REVIEWER]);
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Finance Dashboard</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Welcome, {user.name}. This dashboard is <strong>read-only by design</strong> (BR-18)
        and shows only payments Nandhiya has approved. It is built in Phase 8. This is the
        authenticated role shell (Phase 2).
      </p>
    </section>
  );
}

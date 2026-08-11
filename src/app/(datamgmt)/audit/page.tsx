import { requireRoles } from "@/server/auth/guard";
import { Role } from "@prisma/client";

export default async function AuditHome() {
  const { user } = await requireRoles([Role.DATA_MGMT_AUDITOR]);
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Data Management — L1 Audit</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Welcome, {user.name}. The payment audit queue (the approval gate before Finance)
        is built in Phase 7. This is the authenticated role shell (Phase 2).
      </p>
    </section>
  );
}

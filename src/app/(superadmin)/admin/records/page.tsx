import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { RecordsClient } from "./records-client";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  await requireRoles([Role.SUPER_ADMIN]);
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Records</h1>
        <p className="text-sm text-slate-500">
          Open any lead or payment and see its complete history and every version of its proof (FR-SA-03) — read-only.
        </p>
      </div>
      <RecordsClient />
    </section>
  );
}

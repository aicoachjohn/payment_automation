import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { listSalespeople } from "@/server/services/finance";
import { OverrideConsole } from "./override-console";

export const dynamic = "force-dynamic";

export default async function OverridesPage() {
  const { actor } = await requireRoles([Role.SUPER_ADMIN]);
  const salespeople = await listSalespeople(actor);
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Override tools</h1>
        <p className="text-sm text-slate-500">
          Exceptional actions. Each requires a written reason, previews its exact consequence, writes an immutable
          Super Admin Activity entry and an audit-trail entry, and notifies the affected role. There is no tool here —
          and none anywhere — to edit a payment amount, date or Transaction ID (FR-SA-08, BR-24); correcting an
          approved payment means reversing the audit so it travels back through Sales and Nandhiya.
        </p>
      </div>
      <OverrideConsole salespeople={salespeople} />
    </section>
  );
}

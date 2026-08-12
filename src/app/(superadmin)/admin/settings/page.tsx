import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { listConfig } from "@/server/services/system-config";
import { ConfigEditor, AddConfig } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { actor } = await requireRoles([Role.SUPER_ADMIN]);
  const config = await listConfig(actor);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System Settings</h1>
        <p className="text-sm text-slate-500">
          Every business parameter is configuration, not code (BR-13, NFR-16) — thresholds, the 15-day window, the
          reminder and ageing schedules, GST. Change any value here; the previous and new value are written to the
          audit trail (FR-ADM-04..09).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/admin/pricing" className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Pricing Master →</Link>
        <Link href="/admin/templates" className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Draft template & reason codes →</Link>
        <Link href="/admin/users" className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Users & roles →</Link>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Configuration values</h2>
        {config.length === 0 && <p className="text-sm text-slate-500">No configuration rows yet. Add one below.</p>}
        {config.map((c) => (
          <ConfigEditor
            key={c.key}
            configKey={c.key}
            current={typeof c.value === "string" ? c.value : JSON.stringify(c.value)}
            description={c.description}
          />
        ))}
        <AddConfig />
      </div>
    </section>
  );
}

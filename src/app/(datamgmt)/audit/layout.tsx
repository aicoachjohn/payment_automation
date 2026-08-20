import { Role } from "@prisma/client";
import { AppShell } from "@/components/shared/app-shell";
import { requireRoles } from "@/server/auth/guard";

export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRoles([Role.DATA_MGMT_AUDITOR]);
  return (
    <AppShell user={user} nav={[{ href: "/audit", label: "Audit Queue" }, { href: "/handover", label: "Handovers" }]}>
      {children}
    </AppShell>
  );
}

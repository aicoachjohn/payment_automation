import { Role } from "@prisma/client";
import { AppShell } from "@/components/shared/app-shell";
import { requireRoles } from "@/server/auth/guard";

export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRoles([Role.SALESPERSON, Role.SALES_MANAGER]);
  return (
    <AppShell user={user} nav={[{ href: "/sales", label: "Dashboard" }, { href: "/handover", label: "Handovers" }]}>
      {children}
    </AppShell>
  );
}

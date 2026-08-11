import { Role } from "@prisma/client";
import { AppShell } from "@/components/shared/app-shell";
import { requireRoles } from "@/server/auth/guard";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRoles([Role.FINANCE_REVIEWER]);
  return (
    <AppShell user={user} nav={[{ href: "/finance", label: "Finance" }]}>
      {children}
    </AppShell>
  );
}

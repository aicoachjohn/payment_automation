import { Role } from "@prisma/client";
import { AppShell } from "@/components/shared/app-shell";
import { requireRoles } from "@/server/auth/guard";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRoles([Role.FINANCE_REVIEWER]);
  return (
    <AppShell
      user={user}
      nav={[
        { href: "/finance", label: "Statement" },
        { href: "/handover", label: "Handovers" },
        { href: "/finance/customers", label: "Customers" },
        { href: "/finance/collections", label: "Collections" },
        { href: "/finance/queries", label: "Queries" },
        { href: "/finance/oversight", label: "Admin Oversight" },
      ]}
    >
      {children}
    </AppShell>
  );
}

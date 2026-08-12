import { Role } from "@prisma/client";
import { AppShell } from "@/components/shared/app-shell";
import { requireRoles } from "@/server/auth/guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRoles([Role.SUPER_ADMIN]);
  return (
    <AppShell
      user={user}
      nav={[
        { href: "/admin", label: "Overview" },
        { href: "/admin/users", label: "Users" },
        { href: "/admin/pricing", label: "Pricing" },
        { href: "/admin/templates", label: "Templates" },
      ]}
    >
      {children}
    </AppShell>
  );
}

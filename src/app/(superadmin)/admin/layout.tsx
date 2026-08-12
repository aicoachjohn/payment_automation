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
        { href: "/admin/overrides", label: "Overrides" },
        { href: "/admin/activity", label: "Activity Log" },
        { href: "/admin/audit", label: "Audit Trail" },
        { href: "/admin/records", label: "Records" },
        { href: "/admin/jobs", label: "Jobs" },
        { href: "/admin/users", label: "Users" },
        { href: "/admin/pricing", label: "Pricing" },
        { href: "/admin/templates", label: "Templates" },
        { href: "/admin/settings", label: "Settings" },
      ]}
    >
      {children}
    </AppShell>
  );
}

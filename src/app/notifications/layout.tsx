import { AppShell } from "@/components/shared/app-shell";
import { requireAuth } from "@/server/auth/guard";
import { ROLE_HOME } from "@/server/auth/permissions";

export default async function NotificationsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAuth();
  return (
    <AppShell
      user={user}
      nav={[
        { href: ROLE_HOME[user.role], label: "Dashboard" },
        { href: "/notifications", label: "Notifications" },
      ]}
    >
      {children}
    </AppShell>
  );
}

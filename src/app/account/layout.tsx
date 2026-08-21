import { AppShell } from "@/components/shared/app-shell";
import { requireAuth } from "@/server/auth/guard";
import { ROLE_HOME } from "@/server/auth/permissions";

/**
 * Every role has a profile page, so this layout guards on authentication alone and sends
 * the user home via their own role's dashboard.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAuth();
  return (
    <AppShell
      user={user}
      nav={[
        { href: ROLE_HOME[user.role], label: "Dashboard" },
        { href: "/notifications", label: "Notifications" },
        { href: "/account", label: "My Profile" },
      ]}
    >
      {children}
    </AppShell>
  );
}

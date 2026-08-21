import Link from "next/link";
import type { Role } from "@prisma/client";
import { UserRound } from "lucide-react";
import { LogoutButton } from "@/components/shared/logout-button";

const ROLE_LABEL: Record<Role, string> = {
  SALESPERSON: "Salesperson",
  SALES_MANAGER: "Sales Manager",
  DATA_MGMT_AUDITOR: "Data Management",
  FINANCE_REVIEWER: "Finance",
  SUPER_ADMIN: "Super Admin",
};

/** Where the logo (home button) points for each role. */
const ROLE_HOME: Record<Role, string> = {
  SALESPERSON: "/sales",
  SALES_MANAGER: "/sales",
  DATA_MGMT_AUDITOR: "/audit",
  FINANCE_REVIEWER: "/finance",
  SUPER_ADMIN: "/admin",
};

export interface NavItem {
  href: string;
  label: string;
}

export function AppShell({
  user,
  nav,
  children,
}: {
  user: { name: string; role: Role };
  nav: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-slate-900 dark:text-slate-100">
      {/* Brand accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-brand-navy via-brand-blue to-brand-navy" />

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 dark:border-slate-800 dark:bg-slate-900/85">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-5">
            {/* Logo = home button */}
            <Link href={ROLE_HOME[user.role]} aria-label="ProITbridge home" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/proitbridge-logo-mark.png" alt="ProITbridge" width={143} height={34} className="h-[34px] w-auto" />
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-[44px] items-center rounded-md px-2.5 py-1.5 font-medium text-slate-600 transition hover:bg-brand-blue-50 hover:text-brand-navy sm:min-h-0 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {/* Identity doubles as the way into the profile, where the password lives. */}
            <Link
              href="/account"
              title="My profile"
              className="hidden items-center gap-2 rounded-md px-2 py-1 transition hover:bg-brand-blue-50 sm:flex dark:hover:bg-slate-800"
            >
              <span className="font-medium text-brand-navy dark:text-slate-100">{user.name}</span>
              <span className="rounded-full bg-brand-blue-50 px-2 py-0.5 text-xs font-semibold text-brand-blue-600 dark:bg-slate-800 dark:text-brand-blue">
                {ROLE_LABEL[user.role]}
              </span>
            </Link>
            {/* The name is hidden on a phone, so the profile needs its own target there. */}
            <Link
              href="/account"
              aria-label="My profile"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-slate-600 transition hover:bg-brand-blue-50 hover:text-brand-navy sm:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-slate-200 py-4 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 text-xs text-slate-400">
          ProITbridge · Payment &amp; Enrollment Automation
        </div>
      </footer>
    </div>
  );
}

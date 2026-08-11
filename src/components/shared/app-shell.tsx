import Link from "next/link";
import type { Role } from "@prisma/client";
import { LogoutButton } from "@/components/shared/logout-button";

const ROLE_LABEL: Record<Role, string> = {
  SALESPERSON: "Salesperson",
  SALES_MANAGER: "Sales Manager",
  DATA_MGMT_AUDITOR: "Data Management",
  FINANCE_REVIEWER: "Finance",
  SUPER_ADMIN: "Super Admin",
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
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-slate-500">
              ProITbridge
            </span>
            <nav className="flex gap-3 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-300">
              {user.name} · <span className="text-slate-400">{ROLE_LABEL[user.role]}</span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

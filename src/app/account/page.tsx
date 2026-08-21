import { requireAuth } from "@/server/auth/guard";
import { ChangePasswordForm } from "@/app/account/change-password-form";

const ROLE_LABEL: Record<string, string> = {
  SALESPERSON: "Salesperson",
  SALES_MANAGER: "Sales Manager",
  DATA_MGMT_AUDITOR: "Data Management",
  FINANCE_REVIEWER: "Finance",
  SUPER_ADMIN: "Super Admin",
};

const card = "rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";

export default async function AccountPage() {
  const { user } = await requireAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-navy dark:text-slate-100">My Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Your account details and password.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className={card}>
          <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Name</dt>
              <dd className="text-right font-medium">{user.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Email</dt>
              <dd className="break-all text-right font-medium">{user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Role</dt>
              <dd className="text-right font-medium">{ROLE_LABEL[user.role] ?? user.role}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            Your name, email and role can only be changed by a Super Admin, so that who did
            what stays traceable in the audit trail.
          </p>
          {user.isBreakGlass && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              This is the break-glass Super Admin account. It is for emergency access only,
              and its use is recorded as such.
            </p>
          )}
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold text-brand-navy dark:text-slate-100">Change password</h2>
          <p className="mt-1 text-sm text-slate-500">
            You will stay signed in on this device. Any other device you are signed in on
            will be signed out.
          </p>
          <ChangePasswordForm />
        </section>
      </div>
    </div>
  );
}

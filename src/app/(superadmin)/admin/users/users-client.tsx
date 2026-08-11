"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Role, UserStatus } from "@prisma/client";
import {
  createUserAction,
  updateUserRoleAction,
  deactivateUserAction,
  reactivateUserAction,
} from "./actions";

interface UserRow {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: Role;
  status: UserStatus;
  isBreakGlass: boolean;
  twoFaEnabled: boolean;
  lastLogin: Date | null;
}

const ROLES = Object.values(Role);
const input =
  "rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";

export function UsersClient({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ serverError?: string } | undefined>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res?.serverError) setError(res.serverError);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <CreateUser onSubmit={(data) => run(() => createUserAction(data))} pending={pending} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">2FA</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">
                  {u.name}
                  {u.isBreakGlass && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">break-glass</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{u.email}</td>
                <td className="px-3 py-2">
                  <select
                    className={input}
                    defaultValue={u.role}
                    disabled={pending}
                    onChange={(e) =>
                      run(() => updateUserRoleAction({ userId: u.id, role: e.target.value as Role }))
                    }
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <span className={u.status === UserStatus.ACTIVE ? "text-green-700" : "text-slate-400"}>
                    {u.status}
                  </span>
                </td>
                <td className="px-3 py-2">{u.twoFaEnabled ? "on" : "off"}</td>
                <td className="px-3 py-2">
                  {u.status === UserStatus.ACTIVE ? (
                    <button
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      disabled={pending}
                      onClick={() => run(() => deactivateUserAction({ userId: u.id }))}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      disabled={pending}
                      onClick={() => run(() => reactivateUserAction({ userId: u.id }))}
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUser({
  onSubmit,
  pending,
}: {
  onSubmit: (data: { name: string; email: string; mobile: string; role: Role; isBreakGlass: boolean }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [role, setRole] = useState<Role>(Role.SALESPERSON);
  const [isBreakGlass, setIsBreakGlass] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, email, mobile, role, isBreakGlass });
        setName(""); setEmail(""); setMobile("");
      }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500">Name</label>
        <input className={input} required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500">Email</label>
        <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500">Mobile</label>
        <input className={input} required value={mobile} onChange={(e) => setMobile(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500">Role</label>
        <select className={input} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      {role === Role.SUPER_ADMIN && (
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" checked={isBreakGlass} onChange={(e) => setIsBreakGlass(e.target.checked)} />
          break-glass
        </label>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        Create user
      </button>
    </form>
  );
}

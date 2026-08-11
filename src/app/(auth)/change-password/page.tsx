"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePasswordAction } from "@/app/(auth)/actions";
import { PASSWORD_POLICY } from "@/lib/constants";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";
const button =
  "w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await changePasswordAction({
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError(PASSWORD_POLICY.message);
      const d = res?.data;
      if (!d) return setError("Something went wrong. Please try again.");
      if (!d.ok) return setError(d.error);
      router.push(d.home);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Set a new password</h1>
      <p className="text-sm text-slate-500">
        For your security, please choose a new password before continuing.
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <input type="password" autoComplete="current-password" value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)} className={input}
        placeholder="Current password (skip on first sign-in)" />
      <input type="password" required autoComplete="new-password" value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)} className={input} placeholder="New password" />
      <p className="text-xs text-slate-500">{PASSWORD_POLICY.message}</p>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

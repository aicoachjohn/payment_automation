"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePasswordAction } from "@/app/(auth)/actions";
import { PASSWORD_POLICY } from "@/lib/constants";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const button =
  "w-full rounded-lg bg-brand-navy px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50";

/**
 * The voluntary change, available to every role from their own profile. Unlike the forced
 * first-sign-in change it always demands the current password, so someone who walks up to
 * an unlocked screen cannot take the account over.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (newPassword !== confirmPassword) {
      return setError("The two new passwords do not match.");
    }

    start(async () => {
      const res = await changePasswordAction({ currentPassword, newPassword });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError(PASSWORD_POLICY.message);
      const d = res?.data;
      if (!d) return setError("Something went wrong. Please try again.");
      if (!d.ok) return setError(d.error);

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
      // The server re-issued the session; refresh so this page reflects it.
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Your password has been changed.
        </p>
      )}
      <input
        type="password" required autoComplete="current-password" value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)} className={input}
        placeholder="Current password" aria-label="Current password"
      />
      <input
        type="password" required autoComplete="new-password" value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)} className={input}
        placeholder="New password" aria-label="New password"
      />
      <input
        type="password" required autoComplete="new-password" value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)} className={input}
        placeholder="Confirm new password" aria-label="Confirm new password"
      />
      <p className="text-xs text-slate-500">{PASSWORD_POLICY.message}</p>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

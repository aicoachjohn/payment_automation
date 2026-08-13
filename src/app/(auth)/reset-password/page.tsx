"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { PASSWORD_POLICY } from "@/lib/constants";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const button =
  "w-full rounded-lg bg-brand-navy px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await resetPasswordAction({ token, newPassword });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError(PASSWORD_POLICY.message);
      if (res?.data?.ok) setDone(true);
      else if (res?.data && !res.data.ok) setError(res.data.error);
    });
  }

  if (!token) {
    return <p className="text-sm text-red-600">This reset link is invalid or has expired.</p>;
  }
  if (done) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Your password has been reset. You can now sign in.
        </p>
        <Link href="/login" className="block text-center text-sm text-slate-500 hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <input type="password" required autoComplete="new-password" value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)} className={input} placeholder="New password" />
      <p className="text-xs text-slate-500">{PASSWORD_POLICY.message}</p>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Saving…" : "Reset password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

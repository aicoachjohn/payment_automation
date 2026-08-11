"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/(auth)/actions";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";
const button =
  "w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    start(async () => {
      const res = await forgotPasswordAction({ email });
      if (res?.serverError) return setError(res.serverError);
      if (res?.data?.ok) setMessage(res.data.message);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Reset your password</h1>
      {message ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {message}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Enter your email and we&apos;ll send a reset link if an account exists.
          </p>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          <input type="email" required autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} className={input} placeholder="you@proitbridge.local" />
          <button type="submit" disabled={pending} className={button}>
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </>
      )}
      <p className="text-center text-sm">
        <Link href="/login" className="text-slate-500 hover:underline">Back to sign in</Link>
      </p>
    </form>
  );
}

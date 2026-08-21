"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loginAction } from "@/app/(auth)/actions";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue dark:border-slate-700 dark:bg-slate-800";
const button =
  "w-full rounded-lg bg-brand-navy px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-navy-700 disabled:opacity-50";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await loginAction({ email, password });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Please enter a valid email and password.");
      const d = res?.data;
      if (!d) return setError("Something went wrong. Please try again.");
      if (!d.ok) return setError(d.error);
      if (d.step === "otp") return router.push("/login/otp");
      if (d.step === "change-password") return router.push("/change-password");
      router.push(params.get("next") ?? d.home);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-bold text-brand-navy dark:text-white">Sign in</h1>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)} className={input} />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} className={input} />
      </div>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {/* No self-service reset: email was removed, so a forgotten password is reset by a
          Super Admin under User Management. Saying so beats a dead-end link. */}
      <p className="text-center text-xs text-slate-500">
        Forgotten your password? Ask a Super Admin to reset it for you.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

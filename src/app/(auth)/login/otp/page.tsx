"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyOtpAction } from "@/app/(auth)/actions";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.5em] outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";
const button =
  "w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

export default function OtpPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await verifyOtpAction({ code });
      if (res?.serverError) return setError(res.serverError);
      if (res?.validationErrors) return setError("Enter the 6-digit code.");
      const d = res?.data;
      if (!d) return setError("Something went wrong. Please try again.");
      if (!d.ok) return setError(d.error);
      if (d.step === "change-password") return router.push("/change-password");
      router.push(d.home);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Verification code</h1>
      <p className="text-sm text-slate-500">
        We emailed you a 6-digit code. Enter it to continue. (In dev, the code is printed
        to the server console.)
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <input inputMode="numeric" maxLength={6} required value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={input} aria-label="6-digit code" />
      <button type="submit" disabled={pending || code.length !== 6} className={button}>
        {pending ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}

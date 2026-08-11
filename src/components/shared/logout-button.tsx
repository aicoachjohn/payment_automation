"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutAction } from "@/app/(auth)/actions";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [, setError] = useState<string | null>(null);

  function onLogout() {
    startTransition(async () => {
      const res = await logoutAction();
      if (res?.serverError) {
        setError(res.serverError);
        return;
      }
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={pending}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { markReadAction, markAllReadAction } from "./actions";

interface Item { id: string; type: string; subject: string; body: string; relatedEntityType: string | null; relatedEntityId: string | null; read: boolean; createdAt: string }

function linkFor(item: Item): string | null {
  if (item.relatedEntityType === "Lead") return `/leads/${item.relatedEntityId}`;
  return null;
}

/**
 * The notification centre. In-app is the ONLY channel — email was removed by business
 * decision — so there are no delivery preferences to choose and no second tab.
 */
export function NotificationsClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const [, start] = useTransition();

  function read(id: string) {
    start(async () => { await markReadAction({ notificationId: id }); router.refresh(); });
  }
  function readAll() {
    start(async () => { await markAllReadAction({}); router.refresh(); });
  }

  return (
    <div className="space-y-4">
      {items.some((i) => !i.read) && (
        <div className="flex">
          <button onClick={readAll} className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Mark all read</button>
        </div>
      )}

      <ul className="space-y-2">
        {items.length === 0 && <li className="text-sm text-slate-500">No notifications.</li>}
        {items.map((i) => {
          const href = linkFor(i);
          return (
            <li key={i.id} className={`rounded-lg border p-3 ${i.read ? "border-slate-200 dark:border-slate-800" : "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{i.subject}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">{i.body}</div>
                  <div className="mt-1 text-xs text-slate-400">{formatDate(i.createdAt)}{href && <> · <Link href={href} className="text-sky-600 hover:underline">Open</Link></>}</div>
                </div>
                {!i.read && <button onClick={() => read(i.id)} className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Mark read</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

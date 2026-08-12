import { requireAuth } from "@/server/auth/guard";
import { listNotifications, getPreferences } from "@/server/notifications/center";
import { NotificationsClient } from "./notifications-client";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const { actor } = await requireAuth();
  const [items, prefs] = await Promise.all([listNotifications(actor), getPreferences(actor)]);
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-slate-500">In-app delivery is always on; choose which types also reach you by email.</p>
      </div>
      <NotificationsClient items={items} prefs={prefs} />
    </section>
  );
}

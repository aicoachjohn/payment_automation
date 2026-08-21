import { requireAuth } from "@/server/auth/guard";
import { listNotifications } from "@/server/notifications/center";
import { NotificationsClient } from "./notifications-client";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const { actor } = await requireAuth();
  const items = await listNotifications(actor);
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-slate-500">
          Every approval, hand-off and decision that concerns you appears here.
        </p>
      </div>
      <NotificationsClient items={items} />
    </section>
  );
}

import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { listFinanceQueries } from "@/server/services/finance-queries";
import { QueriesClient } from "./queries-client";

export const dynamic = "force-dynamic";

export default async function FinanceQueriesPage() {
  const { actor } = await requireRoles([Role.FINANCE_REVIEWER]);
  const threads = await listFinanceQueries(actor);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Finance Queries</h1>
        <p className="text-sm text-slate-500">
          Questions raised against approved payments (FR-FIN-10). Raising or replying to a query never alters the
          payment record — it is a separate thread sent to Nandhiya and the salesperson.
        </p>
      </div>
      <QueriesClient threads={threads} />
    </section>
  );
}

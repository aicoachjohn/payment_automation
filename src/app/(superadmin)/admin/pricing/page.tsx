import { requireRoles } from "@/server/auth/guard";
import { Role } from "@prisma/client";
import {
  listAllPricing,
  getConcessionThresholdConfig,
  listReasonCodes,
} from "@/server/services/pricing-admin";
import { PricingClient, type PricingRow } from "./pricing-client";

export default async function PricingPage() {
  await requireRoles([Role.SUPER_ADMIN]);
  const [rows, thresholds, reasonCodes] = await Promise.all([
    listAllPricing(),
    getConcessionThresholdConfig(),
    listReasonCodes(),
  ]);

  const pricing: PricingRow[] = rows.map((r) => ({
    id: r.id,
    program: r.program,
    plan: r.plan,
    advancedFee: r.advancedFee?.toString() ?? null,
    premiumFee: r.premiumFee?.toString() ?? null,
    singleShotFee: r.singleShotFee?.toString() ?? null,
    doubleShotFee: r.doubleShotFee?.toString() ?? null,
    gstPercent: r.gstPercent.toString(),
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo?.toISOString() ?? null,
    status: r.status,
    specialPricingName: r.specialPricingName,
  }));

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Pricing Master</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Effective-dated pricing. Editing a rate creates a new effective row and closes
          the previous one — history is never mutated, and a locked lead keeps its price
          (FR-ADM-02/03). Every change is audited.
        </p>
      </div>
      <PricingClient pricing={pricing} thresholds={thresholds} reasonCodes={reasonCodes} />
    </section>
  );
}

import { Role, Program, Plan, ComboMode, ConcessionStatus } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { getDraftConfig } from "@/server/services/draft";
import { buildDraftContext } from "@/server/services/draft-template";
import { TemplatesClient } from "./templates-client";

export default async function TemplatesPage() {
  await requireRoles([Role.SUPER_ADMIN]);
  const config = await getDraftConfig();

  // Sample data for the live preview (Combo Premium Double Shot with a concession).
  const sampleCtx = buildDraftContext({
    lead: {
      fullName: "Priya Sharma", dob: new Date("1998-05-20"), doorNo: "12A", street: "MG Road",
      address: "Indiranagar", district: "Bengaluru", state: "Karnataka", pincode: "560038",
      email: "priya@example.com", mobile: "9876543210",
    },
    enrollment: {
      program: Program.COMBO_ALL_THREE, plan: Plan.PREMIUM, comboMode: ComboMode.DOUBLE_SHOT,
      commencingDate: new Date("2026-09-01"), standardFee: "89999.00", concessionAmount: "2000.00",
      concessionStatus: ConcessionStatus.APPROVED, finalApprovedFee: "87999.00",
    },
    schedule: [
      { number: 1, amount: "43999.50", dueDate: "2026-09-01T00:00:00.000Z" },
      { number: 2, amount: "43999.50", dueDate: "2026-09-16T00:00:00.000Z" },
    ],
    bankDetails: config.bankDetails,
    instruction: config.instruction,
  });

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Payment-draft template</h1>
        <p className="text-slate-600 dark:text-slate-400">
          The message body and bank details are configuration — edit them here, no code
          change or restart (FR-SAL-33). Use <code className="font-mono text-xs">{"{{placeholders}}"}</code>;
          the live preview uses sample data.
        </p>
      </div>
      <TemplatesClient
        template={config.template}
        bankDetails={config.bankDetails}
        instruction={config.instruction}
        whatsappEnabled={config.whatsappEnabled}
        sampleCtx={sampleCtx}
      />
    </section>
  );
}

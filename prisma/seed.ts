/**
 * Database seed (run via `pnpm db:seed` → `prisma db seed`, which loads .env).
 *
 * Creates one user per role with the exact FRD names, the complete Pricing Master
 * (FRD §5.4.1 / §5.4.2, all GST-inclusive at 18%), and the SystemConfig defaults.
 * Seed users are created with must_change_password = true and a password taken from
 * SEED_DEFAULT_PASSWORD (never hard-coded, never a real secret in VCS).
 */
import { PrismaClient, Role, Program, Plan, PricingStatus } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import {
  DEFAULT_DRAFT_TEMPLATE,
  DEFAULT_BANK_DETAILS,
  DEFAULT_DRAFT_INSTRUCTION,
} from "../src/server/services/draft-template";

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "ChangeMe#123";

interface SeedUser {
  name: string;
  email: string;
  mobile: string;
  role: Role;
}

const USERS: SeedUser[] = [
  { name: "Super Admin", email: "super.admin@proitbridge.local", mobile: "9000000000", role: Role.SUPER_ADMIN },
  { name: "Mathiew", email: "mathiew@proitbridge.local", mobile: "9000000001", role: Role.SALESPERSON },
  { name: "Kevin", email: "kevin@proitbridge.local", mobile: "9000000002", role: Role.SALESPERSON },
  { name: "Dinesh", email: "dinesh@proitbridge.local", mobile: "9000000003", role: Role.SALESPERSON },
  { name: "Hari", email: "hari@proitbridge.local", mobile: "9000000004", role: Role.SALESPERSON },
  { name: "Sales Manager", email: "sales.manager@proitbridge.local", mobile: "9000000005", role: Role.SALES_MANAGER },
  { name: "Nandhiya", email: "nandhiya@proitbridge.local", mobile: "9000000006", role: Role.DATA_MGMT_AUDITOR },
  { name: "Rajesh", email: "rajesh@proitbridge.local", mobile: "9000000007", role: Role.FINANCE_REVIEWER },
];

async function seedUsers(): Promise<string> {
  // Super Admin first so the rest can record created_by.
  const superAdminSpec = USERS[0];
  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminSpec.email },
    update: {},
    create: {
      name: superAdminSpec.name,
      email: superAdminSpec.email,
      mobile: superAdminSpec.mobile,
      passwordHash: await hashPassword(SEED_PASSWORD),
      role: superAdminSpec.role,
      mustChangePassword: true,
      twoFaEnabled: true, // mandatory for SUPER_ADMIN (FR-SEC-05)
    },
  });

  for (const u of USERS.slice(1)) {
    const twoFaMandatory =
      u.role === Role.DATA_MGMT_AUDITOR || u.role === Role.FINANCE_REVIEWER;
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        passwordHash: await hashPassword(SEED_PASSWORD),
        role: u.role,
        mustChangePassword: true,
        twoFaEnabled: twoFaMandatory,
        createdBy: superAdmin.id,
      },
    });
  }

  return superAdmin.id;
}

async function seedPricing(createdBy: string): Promise<void> {
  const now = new Date();
  // Idempotent: clear and re-create the active brochure rows.
  await prisma.pricingMaster.deleteMany({});
  await prisma.pricingMaster.createMany({
    data: [
      // §5.4.1 Standard brochure pricing (GST-inclusive at 18%). One row per program,
      // carrying both plan prices.
      { program: Program.DATA_ANALYST, advancedFee: "24999", premiumFee: "74999", gstPercent: "18", effectiveFrom: now, status: PricingStatus.ACTIVE, createdBy },
      { program: Program.ADV_DATA_SCIENCE_AI, advancedFee: "29999", premiumFee: "79999", gstPercent: "18", effectiveFrom: now, status: PricingStatus.ACTIVE, createdBy },
      { program: Program.AGENTIC_AI_GENAI, advancedFee: "34999", premiumFee: "89999", gstPercent: "18", effectiveFrom: now, status: PricingStatus.ACTIVE, createdBy },
      // §5.4.2 Combo pack pricing (all three programs), Single vs Double shot per plan.
      { program: Program.COMBO_ALL_THREE, plan: Plan.ADVANCED, doubleShotFee: "34999", singleShotFee: "31999", gstPercent: "18", effectiveFrom: now, status: PricingStatus.ACTIVE, createdBy },
      { program: Program.COMBO_ALL_THREE, plan: Plan.PREMIUM, doubleShotFee: "89999", singleShotFee: "84999", gstPercent: "18", effectiveFrom: now, status: PricingStatus.ACTIVE, createdBy },
    ],
  });
}

async function seedSystemConfig(updatedBy: string): Promise<void> {
  const defaults: { key: string; value: unknown; description: string }[] = [
    { key: "down_payment_window_days", value: 15, description: "Days to collect the Down Payment after Course Starting (BR-09)." },
    { key: "reminder_days", value: [3, 7, 10, 13, 14], description: "Reminder schedule (days) within the down-payment window." },
    { key: "audit_ageing_threshold_hours", value: 48, description: "Hours after which a pending audit is flagged as ageing." },
    { key: "gst_percent", value: 18, description: "GST percentage applied to all brochure pricing (BR-13)." },
    { key: "session_timeout_minutes", value: 30, description: "Inactivity session timeout for all roles (FR-SEC-06)." },
    { key: "superadmin_session_timeout_minutes", value: 15, description: "Inactivity session timeout for SUPER_ADMIN (NFR-07a)." },
    { key: "two_fa_trust_scope", value: "working_day", description: "How far one 2FA pass carries on the same browser. 'working_day' = until 23:59:59 IST today, so each morning asks again; 'off' = ask on every sign-in." },
    { key: "max_upload_mb", value: 10, description: "Maximum payment-proof upload size in MB (FR-SEC-22)." },
    { key: "duplicate_payment_window_hours", value: 24, description: "Window for detecting duplicate payment submissions." },
    // Phase 3 — pricing/fee engine configuration (BR-13, NFR-16).
    // Q-02 placeholder: ₹2,000 or 10% whichever is lower, per plan (TODO-BUSINESS).
    {
      key: "concession_threshold",
      value: { ADVANCED: { amount: 2000, percent: 10 }, PREMIUM: { amount: 2000, percent: 10 } },
      description: "Per-plan concession approval threshold: amount cap and percent cap; the lower applies (FR-ADM-05).",
    },
    // Q-05 placeholder: 40 / 40 / 20 default schedule (TODO-BUSINESS).
    { key: "payment_schedule_default", value: [40, 40, 20], description: "Default instalment split (%) when no special arrangement applies." },
    // Q-04 placeholder: Double Shot = 50 / 50 (TODO-BUSINESS).
    { key: "double_shot_split", value: [50, 50], description: "Combo Double Shot instalment split (%)." },
    { key: "single_shot_split", value: [100], description: "Combo Single Shot instalment split (%)." },
    {
      key: "audit_reason_codes",
      value: ["Amount mismatch", "Transaction ID incorrect", "Proof unreadable", "Duplicate payment", "Wrong lead", "Details mismatch"],
      description: "Standard audit reason-code list used by the L1 audit (FR-ADM-09, FR-DM-17).",
    },
    // Phase 5 — payment-draft template & bank details (configuration, FR-SAL-33, FR-ADM-06).
    { key: "payment_draft_template", value: DEFAULT_DRAFT_TEMPLATE, description: "Payment-draft message body ({{placeholder}} syntax)." },
    { key: "company_bank_details", value: DEFAULT_BANK_DETAILS, description: "Company bank / payment details shown in the payment draft." },
    { key: "payment_draft_instruction", value: DEFAULT_DRAFT_INSTRUCTION, description: "Instruction to share the payment screenshot + Transaction ID." },
    // Q-01 placeholder: WhatsApp send is OFF pending business decision (FR-SAL-37).
    { key: "whatsapp_enabled", value: false, description: "Feature flag: show a wa.me WhatsApp send link on the draft (default OFF, Q-01)." },
  ];

  for (const c of defaults) {
    await prisma.systemConfig.upsert({
      where: { key: c.key },
      update: { value: c.value as object, description: c.description, updatedBy },
      create: { key: c.key, value: c.value as object, description: c.description, updatedBy },
    });
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Run via `pnpm db:seed` so .env is loaded.");
  }
  const superAdminId = await seedUsers();
  await seedPricing(superAdminId);
  await seedSystemConfig(superAdminId);

  const [users, pricing, config] = await Promise.all([
    prisma.user.count(),
    prisma.pricingMaster.count(),
    prisma.systemConfig.count(),
  ]);
  console.log(
    `Seed complete: ${users} users, ${pricing} pricing rows, ${config} system config keys.`,
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

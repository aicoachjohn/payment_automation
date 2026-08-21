/**
 * Database seed (run via `pnpm db:seed` → `prisma db seed`, which loads .env).
 *
 * Creates the real ProITbridge team accounts, the complete Pricing Master (FRD §5.4.1 /
 * §5.4.2, all GST-inclusive at 18%), and the SystemConfig defaults.
 *
 * Each account gets a FRESH RANDOM password, printed once to the terminal at the end of the
 * run and stored nowhere else — not in a file, not in this repository, which is public. The
 * hash is all the database keeps. Every account is created with must_change_password = true,
 * so the printed value is good for exactly one sign-in.
 *
 * Safe to re-run: an account that already exists is left completely alone.
 */
import { PrismaClient, Role, Program, Plan, PricingStatus } from "@prisma/client";
import { randomInt } from "node:crypto";
import { hashPassword } from "../src/server/auth/password";
import {
  DEFAULT_DRAFT_TEMPLATE,
  DEFAULT_BANK_DETAILS,
  DEFAULT_DRAFT_INSTRUCTION,
} from "../src/server/services/draft-template";

const prisma = new PrismaClient();

interface SeedUser {
  name: string;
  email: string;
  mobile: string;
  role: Role;
  /**
   * BR-23 allows exactly ONE active Super Admin. A second Super Admin credential may exist
   * only as a documented break-glass account: it works normally, but it is marked so that
   * emergency use is visible rather than silent (docs/PRIVILEGED_ACCESS.md).
   */
  breakGlass?: boolean;
}

/**
 * The real ProITbridge team.
 *
 * Emails are stored LOWER-CASE. Sign-in normalises the address before looking it up, so a
 * stored capital letter would simply never match and the account could not be used.
 *
 * Mobile numbers are placeholders — the schema requires the field, nobody has supplied the
 * real numbers, and an obviously fake number is safer than a plausible wrong one. A Super
 * Admin can correct each under User Management.
 *
 * No Sales Manager is created: there is none by business decision. The role remains in the
 * codebase so one can be appointed later by creating the account (CLAUDE.md).
 */
const USERS: SeedUser[] = [
  // Primary Super Admin first, so every later account records created_by.
  { name: "Naveenkumar", email: "naveenkumar_10033@proitbridge.com", mobile: "9000000001", role: Role.SUPER_ADMIN },
  { name: "AI Coach John", email: "aicoachjohn@proitbridge.com", mobile: "9000000002", role: Role.SUPER_ADMIN, breakGlass: true },

  { name: "Mathiew", email: "mathiew_10003h@proitbridge.com", mobile: "9000000003", role: Role.SALESPERSON },
  { name: "Dineshkumar", email: "dineshkumar_10022@proitbridge.com", mobile: "9000000004", role: Role.SALESPERSON },
  { name: "Kevin Louis", email: "kevinlouis_10008g@proitbridge.com", mobile: "9000000005", role: Role.SALESPERSON },
  { name: "Hariprasath", email: "hariprasath_10028@proitbridge.com", mobile: "9000000006", role: Role.SALESPERSON },

  { name: "Nandhiya", email: "nandhiya_10042@proitbridge.com", mobile: "9000000007", role: Role.DATA_MGMT_AUDITOR },

  { name: "Rajesh", email: "rajesh_10002p@proitbridge.com", mobile: "9000000008", role: Role.FINANCE_REVIEWER },
];

// Ambiguous glyphs are left out deliberately — these passwords get read off a screen and
// typed by hand, where "l1I" and "O0" cost more support time than the entropy is worth.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";

function pick(set: string): string {
  return set[randomInt(set.length)];
}

/**
 * A fresh 14-character password per account, from a CSPRNG (never Math.random).
 *
 * One character of every class the policy demands is included and then shuffled in, so a
 * generated password can never fail `isPasswordStrong` and strand an account that nobody
 * can sign into.
 */
function generatePassword(): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

interface IssuedCredential {
  name: string;
  email: string;
  role: Role;
  password: string;
}

async function seedUsers(): Promise<{ superAdminId: string; issued: IssuedCredential[]; existing: string[] }> {
  const issued: IssuedCredential[] = [];
  const existing: string[] = [];
  let superAdminId = "";

  for (const u of USERS) {
    const found = await prisma.user.findUnique({ where: { email: u.email }, select: { id: true } });
    if (found) {
      // Never touch an account that already exists. Re-running the seed must not reset a
      // password somebody has already chosen, nor print one that was not actually applied.
      existing.push(u.email);
      if (!superAdminId && u.role === Role.SUPER_ADMIN) superAdminId = found.id;
      continue;
    }

    const password = generatePassword();
    const created = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        passwordHash: await hashPassword(password),
        role: u.role,
        // Forces the /change-password step on first sign-in, so the printed password below
        // survives exactly one login before the user replaces it with their own.
        mustChangePassword: true,
        isBreakGlass: u.breakGlass ?? false,
        // Two-factor is OFF by business decision (SystemConfig two_fa_required_roles = []).
        // This per-user flag OVERRIDES that config, so setting it true here would demand an
        // emailed code — and with no mail provider configured that is a locked-out account
        // on day one. Turn it on per user only once email delivery is proven.
        twoFaEnabled: false,
        createdBy: superAdminId || undefined,
      },
    });
    if (!superAdminId && u.role === Role.SUPER_ADMIN) superAdminId = created.id;
    issued.push({ name: u.name, email: u.email, role: u.role, password });
  }

  if (!superAdminId) {
    throw new Error("No Super Admin was seeded or found — the remaining seed data has nobody to attribute.");
  }
  return { superAdminId, issued, existing };
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
    { key: "two_fa_required_roles", value: [], description: "Roles that must clear an emailed verification code at sign-in. Empty = password only (business decision). Put role names back (e.g. [\"SUPER_ADMIN\",\"DATA_MGMT_AUDITOR\",\"FINANCE_REVIEWER\"]) to reinstate it. A MISSING key falls back to those three." },
    { key: "two_fa_trust_scope", value: "working_day", description: "How far one 2FA pass carries on the same browser. 'working_day' = until the end-of-day boundary below, so each morning asks again; 'off' = ask on every sign-in." },
    { key: "two_fa_trust_day_end_hour_ist", value: 4, description: "IST hour (0-23) at which the working day ends for 2FA trust. 4 = 04:00, so a late evening is not cut off at midnight but the next morning is still challenged." },
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
  const { superAdminId, issued, existing } = await seedUsers();
  await seedPricing(superAdminId);
  await seedSystemConfig(superAdminId);

  const [users, pricing, config] = await Promise.all([
    prisma.user.count(),
    prisma.pricingMaster.count(),
    prisma.systemConfig.count(),
  ]);
  console.log(
    `\nSeed complete: ${users} users, ${pricing} pricing rows, ${config} system config keys.`,
  );

  if (existing.length > 0) {
    console.log(`\nAlready existed, left untouched (password unchanged):`);
    for (const email of existing) console.log(`  · ${email}`);
  }

  if (issued.length === 0) return;

  // The only time these values are ever visible. Printed as a block so it can be captured
  // in one go, then distributed to each person over a channel you trust — and not by
  // forwarding this whole log, which would show everyone everyone else's password.
  const width = Math.max(...issued.map((c) => c.email.length));
  console.log(`\n${"─".repeat(width + 34)}`);
  console.log("INITIAL PASSWORDS — shown once, never stored. Give each person their own.");
  console.log("Each must be changed at first sign-in; the app forces it.");
  console.log("─".repeat(width + 34));
  for (const c of issued) {
    console.log(`  ${c.email.padEnd(width)}   ${c.password}   (${c.role})`);
  }
  console.log(`${"─".repeat(width + 34)}\n`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

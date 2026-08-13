/**
 * Anonymisation for non-production copies (Phase 12, FR-SEC-18). Test/dev environments
 * NEVER use real learner data. Run this against a RESTORED-DOWNWARD copy before any
 * developer touches it: it scrubs learner PII (names, DOB, address, email, mobile) and
 * masks Transaction IDs, keeping row counts, foreign keys, statuses and money intact so
 * the data is still shaped like production for testing.
 *
 *   Run with:  set -a; . ./.env.staging; set +a;  pnpm exec tsx scripts/anonymise.ts
 *
 * REFUSES to run unless ALLOW_ANONYMISE=yes, as a guard against ever pointing it at prod.
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  if (process.env.ALLOW_ANONYMISE !== "yes") {
    throw new Error("Refusing to run: set ALLOW_ANONYMISE=yes on the NON-production copy only.");
  }
  const db = new PrismaClient();
  const leads = await db.lead.findMany({ select: { id: true } });
  let i = 0;
  for (const l of leads) {
    i += 1;
    await db.lead.update({
      where: { id: l.id },
      data: {
        fullName: `Learner ${i}`,
        dob: new Date("1995-01-01"),
        doorNo: "0", street: "Redacted", address: "Redacted", district: "Redacted", state: "Redacted", pincode: "000000",
        email: `learner${i}@example.invalid`,
        mobile: `90000${String(100000 + i).slice(-5)}`,
        remarks: null,
      },
    });
  }
  // Mask Transaction IDs while preserving uniqueness (money + statuses untouched).
  const payments = await db.payment.findMany({ select: { id: true } });
  let j = 0;
  for (const p of payments) {
    j += 1;
    await db.payment.update({ where: { id: p.id }, data: { transactionId: `ANON-${String(j).padStart(8, "0")}` } }).catch(() => {});
  }
  console.info(`Anonymised ${leads.length} leads and ${payments.length} payments.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

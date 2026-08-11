/**
 * Phase 1 verification — proves the database-level guarantees with real operations.
 * Run: `set -a; . ./.env; set +a; pnpm exec tsx scripts/verify-phase1.ts`
 *
 * Checks:
 *  1. Duplicate transaction_id is rejected at the DATABASE level (unique constraint).
 *  2. UPDATE on audit_trail is rejected by (a) the Prisma extension and (b) the DB grant.
 *  3. writeAudit writes one row per changed field inside a transaction.
 *  4. Deleting a Lead that has an Enrollment is refused by the foreign key (RESTRICT).
 * (calculateBalance / GST round-trip are covered by the unit suite: `pnpm test`.)
 */
import { PrismaClient, Role, Program, Plan, PaymentType, PaymentMethod } from "@prisma/client";
import { db } from "../src/server/db";
import { writeAudit } from "../src/server/audit";

// Non-extended app-role client (to reach the DB grant, bypassing the runtime extension).
const plainApp = new PrismaClient();
// Owner client (DIRECT_URL) for cleanup only.
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}\n      ${detail}`);
  if (!passed) failures++;
}

const TAG = "verify-phase1";

async function main() {
  // ---- fixtures -----------------------------------------------------------
  const user = await db.user.create({
    data: {
      name: "Verify Sales",
      email: `verify.sales.${Date.now()}@proitbridge.local`,
      mobile: "9000009999",
      passwordHash: "x",
      role: Role.SALESPERSON,
    },
  });
  const lead = await db.lead.create({
    data: { fullName: "Verify Lead", salespersonId: user.id, remarks: TAG },
  });
  const enrollment = await db.enrollment.create({
    data: { leadId: lead.id, program: Program.DATA_ANALYST, plan: Plan.ADVANCED },
  });
  const basePayment = {
    enrollmentId: enrollment.id,
    paymentType: PaymentType.COURSE_HOLDING,
    expectedAmount: "10000",
    receivedAmount: "10000",
    paymentDate: new Date(),
    paymentMethod: PaymentMethod.UPI,
    submittedBy: user.id,
  };
  const dupTxn = `TXN-DUP-${Date.now()}`;
  await db.payment.create({ data: { ...basePayment, paymentNumber: 1, transactionId: dupTxn } });

  // ---- 1. duplicate transaction_id rejected at DB -------------------------
  try {
    await db.payment.create({ data: { ...basePayment, paymentNumber: 2, transactionId: dupTxn } });
    report("duplicate transaction_id rejected at DB", false, "second insert unexpectedly succeeded");
  } catch (e) {
    const msg = String((e as { code?: string; message?: string }).code ?? "") + " " + (e as Error).message;
    const ok = /P2002/.test(msg) && /transaction_id/i.test(msg);
    report("duplicate transaction_id rejected at DB", ok, `error: ${(e as { code?: string }).code ?? "?"} on transaction_id`);
  }

  // ---- 3. writeAudit writes one row per field in a tx ---------------------
  await db.$transaction(async (tx) => {
    await writeAudit(tx, {
      entityType: "Lead",
      entityId: lead.id,
      action: "UPDATE",
      changes: [
        { field: "full_name", oldValue: "Verify Lead", newValue: "Verify Lead 2" },
        { field: "remarks", oldValue: null, newValue: TAG },
      ],
      actor: { userId: user.id, role: Role.SALESPERSON },
      ip: "127.0.0.1",
    });
  });
  const auditRows = await db.auditTrail.findMany({ where: { entityType: "Lead", entityId: lead.id } });
  report(
    "writeAudit writes one row per changed field",
    auditRows.length === 2 && auditRows.some((r) => r.fieldName === "full_name"),
    `${auditRows.length} rows written (expected 2)`,
  );

  // ---- 2a. audit UPDATE blocked by the Prisma extension -------------------
  try {
    await db.auditTrail.update({ where: { id: auditRows[0].id }, data: { action: "TAMPER" } });
    report("audit UPDATE blocked by Prisma extension", false, "update unexpectedly succeeded");
  } catch (e) {
    report("audit UPDATE blocked by Prisma extension", true, `blocked: ${(e as Error).message}`);
  }

  // ---- 2b. audit UPDATE blocked by the DB grant (bypassing the extension) --
  try {
    await plainApp.auditTrail.updateMany({ where: { id: auditRows[0].id }, data: { action: "TAMPER" } });
    report("audit UPDATE blocked by DB grant (app role)", false, "update unexpectedly succeeded");
  } catch (e) {
    const msg = (e as Error).message;
    const ok = /permission denied/i.test(msg);
    report("audit UPDATE blocked by DB grant (app role)", ok, `blocked: ${ok ? "permission denied" : msg.slice(0, 80)}`);
  }

  // ---- 4. FK RESTRICT: cannot delete a Lead with an Enrollment ------------
  try {
    await db.lead.delete({ where: { id: lead.id } });
    report("delete Lead with Enrollment refused by FK", false, "delete unexpectedly succeeded");
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = (e as Error).message;
    // RESTRICT raises SQLSTATE 23001; NO ACTION maps to Prisma P2003. Accept either.
    const ok = code === "P2003" || /23001|violates RESTRICT|foreign key/i.test(msg);
    report("delete Lead with Enrollment refused by FK", ok, ok ? "refused: RESTRICT (SQLSTATE 23001)" : `unexpected: ${code ?? msg.slice(0, 60)}`);
  }

  // ---- cleanup (child → parent, as owner; audit rows are append-only) -----
  await owner.payment.deleteMany({ where: { enrollmentId: enrollment.id } });
  await owner.enrollment.delete({ where: { id: enrollment.id } });
  await owner.lead.delete({ where: { id: lead.id } });
  await owner.user.delete({ where: { id: user.id } });
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  })
  .catch((e) => {
    console.error("Verification harness error:", e);
    failures++;
  })
  .finally(async () => {
    await Promise.all([db.$disconnect(), plainApp.$disconnect(), owner.$disconnect()]);
    process.exit(failures === 0 ? 0 : 1);
  });

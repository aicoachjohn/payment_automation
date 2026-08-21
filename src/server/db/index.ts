/**
 * Prisma client singleton (a single shared instance across the app).
 *
 * The client is extended to BLOCK any update/delete/upsert on the append-only tables
 * `auditTrail` and `superAdminActivity` at runtime (FR-AUD-02, BR-14). This is a
 * defence-in-depth complement to the database-level `REVOKE UPDATE, DELETE` on those
 * tables from the app role (see the initial migration): even a superuser connection
 * is stopped here.
 */
import { PrismaClient } from "@prisma/client";
import { normaliseDatabaseEnv } from "@/server/db/env";

// Before the client reads DATABASE_URL. Hosting platforms rename these variables (see the
// module for which and why), and Prisma would otherwise find nothing.
normaliseDatabaseEnv();

function appendOnlyError(): never {
  // Safe message (NFR-11): says what is wrong, leaks no internal detail.
  throw new Error(
    "This record is part of the append-only audit history and cannot be modified or deleted.",
  );
}

const blockWrites = {
  update: appendOnlyError,
  updateMany: appendOnlyError,
  upsert: appendOnlyError,
  delete: appendOnlyError,
  deleteMany: appendOnlyError,
};

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends({
    query: {
      auditTrail: blockWrites,
      superAdminActivity: blockWrites,
    },
  });
}

export type Db = ReturnType<typeof createPrismaClient>;

/**
 * The transaction-client type for the extended client — what `db.$transaction((tx) => …)`
 * hands you. Mirrors Prisma's interactive-transaction deny-list. Services and the audit
 * writer accept this so they compose inside a transaction.
 */
export type DbTx = Omit<
  Db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db: Db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

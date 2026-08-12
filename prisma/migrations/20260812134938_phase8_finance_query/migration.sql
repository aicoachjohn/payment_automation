-- CreateEnum
CREATE TYPE "FinanceQueryStatus" AS ENUM ('OPEN', 'ANSWERED', 'RESOLVED');

-- CreateTable
CREATE TABLE "finance_query" (
    "query_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "raised_by" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "FinanceQueryStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_query_pkey" PRIMARY KEY ("query_id")
);

-- CreateTable
CREATE TABLE "finance_query_comment" (
    "comment_id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_role" "Role" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_query_comment_pkey" PRIMARY KEY ("comment_id")
);

-- CreateIndex
CREATE INDEX "finance_query_payment_id_idx" ON "finance_query"("payment_id");

-- CreateIndex
CREATE INDEX "finance_query_status_idx" ON "finance_query"("status");

-- CreateIndex
CREATE INDEX "finance_query_raised_by_idx" ON "finance_query"("raised_by");

-- CreateIndex
CREATE INDEX "finance_query_comment_query_id_idx" ON "finance_query_comment"("query_id");

-- AddForeignKey
ALTER TABLE "finance_query" ADD CONSTRAINT "finance_query_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("payment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_query_comment" ADD CONSTRAINT "finance_query_comment_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "finance_query"("query_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Least-privilege app role (FR-SEC-11). ALTER DEFAULT PRIVILEGES in the init
-- migration already covers new tables, but we are explicit here for clarity — the
-- same pattern used for the session tables. Finance may raise queries and thread
-- comments (a write to this communication entity only, never to payment data, BR-18).
GRANT SELECT, INSERT, UPDATE, DELETE ON "finance_query" TO proitbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "finance_query_comment" TO proitbridge_app;

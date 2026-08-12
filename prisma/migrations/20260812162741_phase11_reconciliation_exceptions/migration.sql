-- CreateTable
CREATE TABLE "reconciliation_exception" (
    "exception_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enrollment_id" TEXT,
    "entity_ref" TEXT,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution_note" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "raised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_exception_pkey" PRIMARY KEY ("exception_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_exception_dedupe_key_key" ON "reconciliation_exception"("dedupe_key");

-- CreateIndex
CREATE INDEX "reconciliation_exception_status_idx" ON "reconciliation_exception"("status");

-- CreateIndex
CREATE INDEX "reconciliation_exception_kind_idx" ON "reconciliation_exception"("kind");

-- Least-privilege app role (FR-SEC-11): explicit grant for the new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "reconciliation_exception" TO proitbridge_app;

-- CreateTable
CREATE TABLE "sheet_sync_outbox" (
    "outbox_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),

    CONSTRAINT "sheet_sync_outbox_pkey" PRIMARY KEY ("outbox_id")
);

-- CreateIndex
CREATE INDEX "sheet_sync_outbox_status_created_at_idx" ON "sheet_sync_outbox"("status", "created_at");

-- CreateIndex
CREATE INDEX "sheet_sync_outbox_lead_id_idx" ON "sheet_sync_outbox"("lead_id");

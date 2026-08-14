-- CreateTable
CREATE TABLE "lead_self_proof" (
    "self_proof_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "original_filename" TEXT,
    "ocr_fields" JSONB,
    "ocr_confidence" JSONB,
    "consumed_payment_id" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_self_proof_pkey" PRIMARY KEY ("self_proof_id")
);

-- CreateIndex
CREATE INDEX "lead_self_proof_lead_id_idx" ON "lead_self_proof"("lead_id");

-- AddForeignKey
ALTER TABLE "lead_self_proof" ADD CONSTRAINT "lead_self_proof_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead"("lead_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Least-privilege runtime grants (FR-SEC-11). Held proofs are consumed (UPDATE), never deleted.
GRANT SELECT, INSERT, UPDATE ON "lead_self_proof" TO proitbridge_app;

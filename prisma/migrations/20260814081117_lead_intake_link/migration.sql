-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "interested_plan" "Plan",
ADD COLUMN     "interested_program" "Program";

-- CreateTable
CREATE TABLE "lead_intake_invite" (
    "invite_id" TEXT NOT NULL,
    "salesperson_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_lead_id" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_intake_invite_pkey" PRIMARY KEY ("invite_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_intake_invite_token_hash_key" ON "lead_intake_invite"("token_hash");

-- CreateIndex
CREATE INDEX "lead_intake_invite_salesperson_id_idx" ON "lead_intake_invite"("salesperson_id");

-- AddForeignKey
ALTER TABLE "lead_intake_invite" ADD CONSTRAINT "lead_intake_invite_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Least-privilege runtime grants (FR-SEC-11). Invites are single-use and never deleted, so
-- the app role gets SELECT/INSERT/UPDATE only (no DELETE).
GRANT SELECT, INSERT, UPDATE ON "lead_intake_invite" TO proitbridge_app;

-- CreateEnum
CREATE TYPE "HandoverStage" AS ENUM ('WITH_DATA_MGMT', 'WITH_FINANCE');

-- AlterTable
ALTER TABLE "operations_handover" ADD COLUMN     "passed_to_finance_at" TIMESTAMP(3),
ADD COLUMN     "passed_to_finance_by" TEXT,
ADD COLUMN     "stage" "HandoverStage" NOT NULL DEFAULT 'WITH_DATA_MGMT';

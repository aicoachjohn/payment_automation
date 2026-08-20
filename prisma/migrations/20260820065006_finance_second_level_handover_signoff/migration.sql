-- AlterEnum
ALTER TYPE "HandoverStage" ADD VALUE 'FINANCE_APPROVED';

-- AlterTable
ALTER TABLE "operations_handover" ADD COLUMN     "finance_decision_at" TIMESTAMP(3),
ADD COLUMN     "finance_decision_by" TEXT,
ADD COLUMN     "finance_rejection_reason" TEXT;

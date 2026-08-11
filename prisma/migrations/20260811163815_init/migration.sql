-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SALESPERSON', 'SALES_MANAGER', 'DATA_MGMT_AUDITOR', 'FINANCE_REVIEWER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW_LEAD', 'INTERESTED', 'BASIC_DETAILS_PENDING', 'BASIC_DETAILS_RECEIVED', 'PAYMENT_DRAFT_GENERATED', 'PAYMENT_PENDING', 'HOLDING_OR_STARTING_RECEIVED', 'DOWN_PAYMENT_PENDING', 'DOWN_PAYMENT_RECEIVED', 'FINAL_PAYMENT_PENDING', 'FULLY_PAID', 'ENROLLMENT_COMPLETED', 'OPERATIONS_HANDOVER');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PENDING_AUDIT', 'APPROVED', 'CORRECTION_REQUIRED', 'REJECTED', 'RESUBMITTED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('COURSE_HOLDING', 'COURSE_STARTING', 'DOWN_PAYMENT', 'FINAL_PAYMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'NEFT', 'IMPS', 'RTGS', 'CARD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "Program" AS ENUM ('DATA_ANALYST', 'ADV_DATA_SCIENCE_AI', 'AGENTIC_AI_GENAI', 'COMBO_ALL_THREE');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('ADVANCED', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ComboMode" AS ENUM ('SINGLE_SHOT', 'DOUBLE_SHOT');

-- CreateEnum
CREATE TYPE "ConcessionStatus" AS ENUM ('NONE', 'AUTO_APPROVED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConcessionThresholdType" AS ENUM ('AMOUNT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PricingStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "HandoverType" AS ENUM ('MANUAL', 'AUTO_DAY15');

-- CreateTable
CREATE TABLE "user" (
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "two_fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_fa_secret" TEXT,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),
    "created_by" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "lead" (
    "lead_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "dob" TIMESTAMP(3),
    "door_no" TEXT,
    "street" TEXT,
    "address" TEXT,
    "district" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "lead_source" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW_LEAD',
    "salesperson_id" TEXT NOT NULL,
    "remarks" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voided_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "enrollment_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "program" "Program" NOT NULL,
    "plan" "Plan" NOT NULL,
    "combo_mode" "ComboMode",
    "commencing_date" TIMESTAMP(3),
    "batch" TEXT,
    "course_started_flag" BOOLEAN NOT NULL DEFAULT false,
    "standard_fee" DECIMAL(12,2),
    "concession_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "concession_reason" TEXT,
    "concession_status" "ConcessionStatus" NOT NULL DEFAULT 'NONE',
    "final_approved_fee" DECIMAL(12,2),
    "gst_percent" DECIMAL(5,2),
    "base_fee" DECIMAL(12,2),
    "gst_amount" DECIMAL(12,2),
    "fee_locked_at" TIMESTAMP(3),
    "pricing_id" TEXT,
    "enrollment_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "payment_schedule" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateTable
CREATE TABLE "payment" (
    "payment_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "payment_number" INTEGER NOT NULL,
    "payment_type" "PaymentType" NOT NULL,
    "expected_amount" DECIMAL(12,2) NOT NULL,
    "received_amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "payment_status" TEXT NOT NULL DEFAULT 'RECORDED',
    "audit_status" "AuditStatus" NOT NULL DEFAULT 'PENDING_AUDIT',
    "submitted_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audited_by" TEXT,
    "audited_at" TIMESTAMP(3),
    "audit_reason_code" TEXT,
    "audit_comment" TEXT,
    "variance_reason" TEXT,
    "manual_entry_no_ocr" BOOLEAN NOT NULL DEFAULT false,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voided_reason" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "payment_proof" (
    "proof_file_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "ocr_raw_output" JSONB,
    "checksum_sha256" TEXT NOT NULL,
    "virus_scan_status" TEXT NOT NULL DEFAULT 'PENDING',
    "original_filename" TEXT NOT NULL,

    CONSTRAINT "payment_proof_pkey" PRIMARY KEY ("proof_file_id")
);

-- CreateTable
CREATE TABLE "pricing_master" (
    "pricing_id" TEXT NOT NULL,
    "program" "Program" NOT NULL,
    "plan" "Plan",
    "advanced_fee" DECIMAL(12,2),
    "premium_fee" DECIMAL(12,2),
    "single_shot_fee" DECIMAL(12,2),
    "double_shot_fee" DECIMAL(12,2),
    "combo_fee" DECIMAL(12,2),
    "discount" DECIMAL(12,2),
    "concession_threshold_value" DECIMAL(12,2),
    "concession_threshold_type" "ConcessionThresholdType",
    "gst_percent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "special_pricing_flag" BOOLEAN NOT NULL DEFAULT false,
    "special_pricing_name" TEXT,
    "status" "PricingStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_master_pkey" PRIMARY KEY ("pricing_id")
);

-- CreateTable
CREATE TABLE "payment_draft" (
    "draft_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "draft_content" TEXT NOT NULL,
    "draft_snapshot" JSONB NOT NULL,
    "generated_by" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_draft_pkey" PRIMARY KEY ("draft_id")
);

-- CreateTable
CREATE TABLE "audit_trail" (
    "audit_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field_name" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "performed_by" TEXT NOT NULL,
    "performed_by_role" "Role" NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,

    CONSTRAINT "audit_trail_pkey" PRIMARY KEY ("audit_id")
);

-- CreateTable
CREATE TABLE "super_admin_activity" (
    "activity_id" TEXT NOT NULL,
    "super_admin_id" TEXT NOT NULL,
    "override_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "reason_text" TEXT NOT NULL,
    "previous_state" JSONB,
    "new_state" JSONB,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_to" TEXT[],

    CONSTRAINT "super_admin_activity_pkey" PRIMARY KEY ("activity_id")
);

-- CreateTable
CREATE TABLE "notification" (
    "notification_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "follow_up_task" (
    "task_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "assigned_to" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_task_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "operations_handover" (
    "handover_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "handover_type" "HandoverType" NOT NULL,
    "validated_flag" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "handover_date" TIMESTAMP(3),
    "generated_by" TEXT NOT NULL,
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operations_handover_pkey" PRIMARY KEY ("handover_id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "security_event" (
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" TEXT,
    "ip_address" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_role_idx" ON "user"("role");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE INDEX "lead_salesperson_id_idx" ON "lead"("salesperson_id");

-- CreateIndex
CREATE INDEX "lead_mobile_idx" ON "lead"("mobile");

-- CreateIndex
CREATE INDEX "lead_email_idx" ON "lead"("email");

-- CreateIndex
CREATE INDEX "lead_status_idx" ON "lead"("status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_lead_id_key" ON "enrollment"("lead_id");

-- CreateIndex
CREATE INDEX "enrollment_pricing_id_idx" ON "enrollment"("pricing_id");

-- CreateIndex
CREATE INDEX "enrollment_enrollment_status_idx" ON "enrollment"("enrollment_status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transaction_id_key" ON "payment"("transaction_id");

-- CreateIndex
CREATE INDEX "payment_audit_status_idx" ON "payment"("audit_status");

-- CreateIndex
CREATE INDEX "payment_submitted_at_idx" ON "payment"("submitted_at");

-- CreateIndex
CREATE INDEX "payment_audited_at_idx" ON "payment"("audited_at");

-- CreateIndex
CREATE INDEX "payment_enrollment_id_idx" ON "payment"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_enrollment_id_payment_number_key" ON "payment"("enrollment_id", "payment_number");

-- CreateIndex
CREATE INDEX "payment_proof_payment_id_idx" ON "payment_proof"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_proof_payment_id_version_key" ON "payment_proof"("payment_id", "version");

-- CreateIndex
CREATE INDEX "pricing_master_program_plan_idx" ON "pricing_master"("program", "plan");

-- CreateIndex
CREATE INDEX "pricing_master_status_effective_from_idx" ON "pricing_master"("status", "effective_from");

-- CreateIndex
CREATE INDEX "payment_draft_enrollment_id_idx" ON "payment_draft"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_draft_enrollment_id_version_key" ON "payment_draft"("enrollment_id", "version");

-- CreateIndex
CREATE INDEX "audit_trail_entity_type_entity_id_idx" ON "audit_trail"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_trail_performed_at_idx" ON "audit_trail"("performed_at");

-- CreateIndex
CREATE INDEX "audit_trail_performed_by_idx" ON "audit_trail"("performed_by");

-- CreateIndex
CREATE INDEX "super_admin_activity_super_admin_id_idx" ON "super_admin_activity"("super_admin_id");

-- CreateIndex
CREATE INDEX "super_admin_activity_performed_at_idx" ON "super_admin_activity"("performed_at");

-- CreateIndex
CREATE INDEX "notification_recipient_id_status_idx" ON "notification"("recipient_id", "status");

-- CreateIndex
CREATE INDEX "notification_scheduled_at_idx" ON "notification"("scheduled_at");

-- CreateIndex
CREATE INDEX "follow_up_task_lead_id_idx" ON "follow_up_task"("lead_id");

-- CreateIndex
CREATE INDEX "follow_up_task_assigned_to_status_idx" ON "follow_up_task"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "operations_handover_enrollment_id_idx" ON "operations_handover"("enrollment_id");

-- CreateIndex
CREATE INDEX "security_event_event_type_created_at_idx" ON "security_event"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "security_event_user_id_idx" ON "security_event"("user_id");

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead"("lead_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_pricing_id_fkey" FOREIGN KEY ("pricing_id") REFERENCES "pricing_master"("pricing_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("enrollment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("payment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_draft" ADD CONSTRAINT "payment_draft_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("enrollment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_task" ADD CONSTRAINT "follow_up_task_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead"("lead_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations_handover" ADD CONSTRAINT "operations_handover_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("enrollment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 hardening (hand-authored; Prisma does not model these).
-- ─────────────────────────────────────────────────────────────────────────────

-- CHECK constraints on financial fields (FR-SEC-19). final_approved_fee is set at
-- fee-lock time, so it may be NULL before then, but must be > 0 once present.
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_received_amount_nonneg" CHECK ("received_amount" >= 0);
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_expected_amount_nonneg" CHECK ("expected_amount" >= 0);
ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_final_approved_fee_positive"
  CHECK ("final_approved_fee" IS NULL OR "final_approved_fee" > 0);

-- Least-privilege app role (FR-SEC-11): the application connects as proitbridge_app,
-- which holds DML but NO schema-alteration or role-administration rights. Migrations
-- run as the owner via DIRECT_URL; the app runs as this role via DATABASE_URL.
GRANT USAGE ON SCHEMA public TO proitbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proitbridge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO proitbridge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO proitbridge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO proitbridge_app;

-- Append-only audit tables (FR-AUD-02, FR-SEC-11, BR-14): the app role may INSERT and
-- SELECT, but can NEVER update or delete an audit record at the database level. This
-- is enforced in addition to the runtime Prisma client extension (src/server/db).
REVOKE UPDATE, DELETE ON "audit_trail" FROM proitbridge_app;
REVOKE UPDATE, DELETE ON "super_admin_activity" FROM proitbridge_app;

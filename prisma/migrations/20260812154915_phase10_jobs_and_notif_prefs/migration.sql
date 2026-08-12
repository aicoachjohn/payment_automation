-- CreateTable
CREATE TABLE "job_run" (
    "job_run_id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "detail" JSONB,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("job_run_id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "pref_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("pref_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_run_dedupe_key_key" ON "job_run"("dedupe_key");

-- CreateIndex
CREATE INDEX "job_run_job_name_ran_at_idx" ON "job_run"("job_name", "ran_at");

-- CreateIndex
CREATE INDEX "notification_preference_user_id_idx" ON "notification_preference"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_user_id_type_key" ON "notification_preference"("user_id", "type");

-- Least-privilege app role (FR-SEC-11): explicit grants for the new tables, matching the
-- pattern used for the session and finance-query tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_run" TO proitbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preference" TO proitbridge_app;

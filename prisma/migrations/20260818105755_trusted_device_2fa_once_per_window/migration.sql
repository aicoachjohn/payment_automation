-- CreateTable
CREATE TABLE "trusted_device" (
    "device_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "trusted_device_pkey" PRIMARY KEY ("device_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_device_token_hash_key" ON "trusted_device"("token_hash");

-- CreateIndex
CREATE INDEX "trusted_device_user_id_idx" ON "trusted_device"("user_id");

-- AddForeignKey
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "BillingNoticeStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "BillingNotice" (
    "id" TEXT NOT NULL,
    "billingEventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "BillingNoticeStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingNotice_billingEventId_key" ON "BillingNotice"("billingEventId");
CREATE INDEX "BillingNotice_status_nextAttemptAt_idx" ON "BillingNotice"("status", "nextAttemptAt");

ALTER TABLE "BillingNotice" ADD CONSTRAINT "BillingNotice_billingEventId_fkey" FOREIGN KEY ("billingEventId") REFERENCES "BillingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingNotice" ADD CONSTRAINT "BillingNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "JobStatus_new" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING');

ALTER TABLE "Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Job"
ALTER COLUMN "status" TYPE "JobStatus_new"
USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'RECEIVED'
    WHEN 'RUNNING' THEN 'PROCESSING'
    ELSE "status"::text
  END
)::"JobStatus_new";
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';
DROP TYPE "JobStatus";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";

ALTER TABLE "Job" ADD COLUMN "errorLog" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Job" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
CREATE INDEX "Job_organizationId_status_idx" ON "Job"("organizationId", "status");

CREATE TYPE "ConnectorProvider" AS ENUM ('FLUXORA_INBOX', 'GMAIL', 'OUTLOOK', 'GOOGLE_DRIVE', 'ONEDRIVE', 'PENNYLANE', 'SAGE', 'CEGID', 'EBP');
CREATE TYPE "ConnectorStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');
CREATE TYPE "InboundItemStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DUPLICATE');

CREATE TABLE "ConnectorAccount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "ConnectorProvider" NOT NULL,
  "status" "ConnectorStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "externalAccountId" TEXT,
  "scopes" TEXT NOT NULL DEFAULT '',
  "encryptedTokens" TEXT,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "lastError" TEXT,
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectorAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectorAccount_externalAccountId_key" ON "ConnectorAccount"("externalAccountId");
CREATE UNIQUE INDEX "ConnectorAccount_organizationId_provider_key" ON "ConnectorAccount"("organizationId", "provider");
CREATE INDEX "ConnectorAccount_organizationId_idx" ON "ConnectorAccount"("organizationId");

CREATE TABLE "InboundMessage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectorAccountId" TEXT,
  "provider" "ConnectorProvider" NOT NULL,
  "sourceAddress" TEXT NOT NULL,
  "recipientAddress" TEXT NOT NULL,
  "subject" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "status" "InboundItemStatus" NOT NULL DEFAULT 'RECEIVED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboundMessage_organizationId_receivedAt_idx" ON "InboundMessage"("organizationId", "receivedAt");

CREATE TABLE "InboundAttachment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "contentHash" TEXT,
  "documentId" TEXT,
  "status" "InboundItemStatus" NOT NULL DEFAULT 'RECEIVED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundAttachment_organizationId_contentHash_key" ON "InboundAttachment"("organizationId", "contentHash");
CREATE INDEX "InboundAttachment_messageId_idx" ON "InboundAttachment"("messageId");

ALTER TABLE "ConnectorAccount" ADD CONSTRAINT "ConnectorAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_connectorAccountId_fkey" FOREIGN KEY ("connectorAccountId") REFERENCES "ConnectorAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InboundAttachment" ADD CONSTRAINT "InboundAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "InboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundAttachment" ADD CONSTRAINT "InboundAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

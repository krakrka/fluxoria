-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'REJECTED';

ALTER TYPE "DocumentKind" ADD VALUE 'TRANSPORT_DOCUMENT';
ALTER TYPE "DocumentKind" ADD VALUE 'CREDIT_NOTE';
ALTER TYPE "DocumentKind" ADD VALUE 'RECEIPT';
ALTER TYPE "DocumentKind" ADD VALUE 'QUALITY_DOCUMENT';
ALTER TYPE "DocumentKind" ADD VALUE 'CMR';
ALTER TYPE "DocumentKind" ADD VALUE 'INTERVENTION_REPORT';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Document_organizationId_deletedAt_idx" ON "Document"("organizationId", "deletedAt");

-- CreateTable
CREATE TABLE "DocumentProcessingRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT NOT NULL,
    "kind" "DocumentKind",
    "confidence" DOUBLE PRECISION,
    "snapshot" JSONB NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentProcessingRun_documentId_startedAt_idx" ON "DocumentProcessingRun"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "DocumentProcessingRun_organizationId_idx" ON "DocumentProcessingRun"("organizationId");

-- AddForeignKey
ALTER TABLE "DocumentProcessingRun" ADD CONSTRAINT "DocumentProcessingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProcessingRun" ADD CONSTRAINT "DocumentProcessingRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

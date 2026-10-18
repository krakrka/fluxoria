-- CreateEnum
CREATE TYPE "AnomalyType" AS ENUM ('AMOUNT_MISMATCH', 'QUANTITY_MISMATCH', 'SUPPLIER_MISMATCH', 'CURRENCY_MISMATCH', 'MISSING_PURCHASE_ORDER', 'DUPLICATE_INVOICE', 'LOW_CONFIDENCE', 'MISSING_REQUIRED_FIELD');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "normalizedName" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "paymentTerms" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "normalizedName" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "address" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "amountVat" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "Anomaly" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT,
    "invoiceId" TEXT,
    "purchaseOrderId" TEXT,
    "supplierId" TEXT,
    "type" "AnomalyType" NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedValue" TEXT,
    "actualValue" TEXT,
    "fingerprint" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_organizationId_siren_idx" ON "Supplier"("organizationId", "siren");
CREATE INDEX "Supplier_organizationId_normalizedName_idx" ON "Supplier"("organizationId", "normalizedName");
CREATE INDEX "Customer_organizationId_siren_idx" ON "Customer"("organizationId", "siren");
CREATE INDEX "Invoice_organizationId_supplierId_idx" ON "Invoice"("organizationId", "supplierId");
CREATE INDEX "Invoice_organizationId_issuedAt_idx" ON "Invoice"("organizationId", "issuedAt");
CREATE INDEX "Anomaly_organizationId_status_idx" ON "Anomaly"("organizationId", "status");
CREATE INDEX "Anomaly_organizationId_fingerprint_idx" ON "Anomaly"("organizationId", "fingerprint");
CREATE INDEX "Anomaly_invoiceId_idx" ON "Anomaly"("invoiceId");
CREATE INDEX "Anomaly_documentId_idx" ON "Anomaly"("documentId");

-- AddForeignKey
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

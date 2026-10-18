ALTER TYPE "AnomalyStatus" ADD VALUE 'SUPERSEDED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'VALIDATED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'REJECTED';
ALTER TYPE "ExecutionStatus" ADD VALUE 'SKIPPED';

CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TABLE "Invoice" ADD COLUMN "autoValidated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AutomationRule" ADD COLUMN "createdById" TEXT;
ALTER TABLE "WorkflowExecution" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "WorkflowExecution" ADD COLUMN "trigger" TEXT;
ALTER TABLE "WorkflowExecution" ADD COLUMN "context" JSONB;

CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT,
    "invoiceId" TEXT,
    "requestedById" TEXT,
    "assignedToId" TEXT,
    "decidedById" TEXT,
    "requiredRole" "MemberRole" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "comment" TEXT,
    "explanation" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowExecution_organizationId_dedupeKey_key" ON "WorkflowExecution"("organizationId", "dedupeKey");
CREATE INDEX "WorkflowStep_workflowId_position_idx" ON "WorkflowStep"("workflowId", "position");
CREATE INDEX "Approval_organizationId_status_idx" ON "Approval"("organizationId", "status");
CREATE INDEX "Approval_invoiceId_idx" ON "Approval"("invoiceId");
CREATE INDEX "Approval_assignedToId_idx" ON "Approval"("assignedToId");

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

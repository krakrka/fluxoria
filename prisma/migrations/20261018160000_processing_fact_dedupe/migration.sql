-- Clés nulles : les lignes déjà présentes restent distinctes.
-- Aucune réécriture et aucune suppression.

ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "ProductEvent" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Notification_organizationId_dedupeKey_key" ON "Notification"("organizationId", "dedupeKey");
CREATE UNIQUE INDEX "ProductEvent_organizationId_dedupeKey_key" ON "ProductEvent"("organizationId", "dedupeKey");
CREATE UNIQUE INDEX "AuditLog_organizationId_dedupeKey_key" ON "AuditLog"("organizationId", "dedupeKey");

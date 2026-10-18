import "server-only";
import type { FileSourceProvider } from "@/connectors/files/types";
import { writeAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { createUploadedDocuments } from "@/services/documents";
import { enqueueDocumentProcessing } from "@/services/queue";

export async function importFileSource(input: {
  organizationId: string;
  userId: string;
  provider: FileSourceProvider;
  accessToken: string;
}) {
  const files = await input.provider.listFiles({ accessToken: input.accessToken });
  const accepted: string[] = [];
  const rejected: Array<{ filename: string; error: string }> = [];
  for (const file of files) {
    try {
      const downloaded = await input.provider.download({ accessToken: input.accessToken, externalId: file.externalId });
      const documents = await createUploadedDocuments({
        organizationId: input.organizationId,
        userId: input.userId,
        files: [downloaded],
      });
      await enqueueDocumentProcessing(input.organizationId, documents[0].id);
      accepted.push(documents[0].filename);
    } catch (error) {
      rejected.push({ filename: file.filename, error: error instanceof Error ? error.message : "Import impossible." });
    }
  }
  await prisma.connectorAccount.updateMany({
    where: { organizationId: input.organizationId, provider: input.provider.id },
    data: { lastSyncAt: new Date(), lastError: rejected[0]?.error ?? null, status: rejected.length > 0 && accepted.length === 0 ? "ERROR" : "CONNECTED" },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "filesource.imported",
    entityType: "ConnectorAccount",
    entityId: input.provider.id,
    newValue: { accepted: accepted.length, rejected: rejected.length },
  });
  return { accepted, rejected };
}

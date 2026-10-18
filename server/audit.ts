import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

type AuditInput = {
  organizationId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  documentId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
};

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function writeAudit(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      documentId: input.documentId ?? null,
      oldValue: toJson(input.oldValue),
      newValue: toJson(input.newValue),
    },
  });
}

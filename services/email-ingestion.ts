import "server-only";
import { createHash } from "crypto";
import type { ConnectorProvider } from "@prisma/client";
import type { InboundEmail } from "@/connectors/email/types";
import { inboxAddressFor } from "@/lib/inbox-address";
import { writeAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { createUploadedDocuments } from "@/services/documents";
import { enqueueDocumentProcessing } from "@/services/queue";

export async function ensureInbox(organizationId: string) {
  const address = inboxAddressFor(organizationId);
  return prisma.connectorAccount.upsert({
    where: { organizationId_provider: { organizationId, provider: "FLUXORA_INBOX" } },
    create: {
      organizationId,
      provider: "FLUXORA_INBOX",
      status: "CONNECTED",
      externalAccountId: address,
      scopes: "inbound:attachments",
    },
    update: { externalAccountId: address, status: "CONNECTED" },
  });
}

export async function findOrganizationByInbox(address: string) {
  const account = await prisma.connectorAccount.findFirst({
    where: { provider: "FLUXORA_INBOX", externalAccountId: address.trim().toLowerCase() },
    select: { organizationId: true },
  });
  return account?.organizationId ?? null;
}

export async function acceptInboundEmail(input: {
  organizationId: string;
  userId: string | null;
  provider: ConnectorProvider;
  message: InboundEmail;
}) {
  const account = input.provider === "FLUXORA_INBOX" ? await ensureInbox(input.organizationId) : await prisma.connectorAccount.findFirst({
    where: { organizationId: input.organizationId, provider: input.provider },
  });
  const message = await prisma.inboundMessage.create({
    data: {
      organizationId: input.organizationId,
      connectorAccountId: account?.id,
      provider: input.provider,
      sourceAddress: input.message.from,
      recipientAddress: input.message.recipient || inboxAddressFor(input.organizationId),
      subject: input.message.subject,
      receivedAt: input.message.receivedAt,
      status: "PROCESSING",
    },
  });
  let created = 0;
  let duplicates = 0;
  let rejected = 0;
  const errors: string[] = [];
  for (const attachment of input.message.attachments) {
    const hash = createHash("sha256").update(attachment.bytes).digest("hex");
    const duplicate = await prisma.inboundAttachment.findFirst({
      where: { organizationId: input.organizationId, contentHash: hash },
      select: { id: true },
    });
    if (duplicate) {
      duplicates += 1;
      await prisma.inboundAttachment.create({
        data: {
          organizationId: input.organizationId,
          messageId: message.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.bytes.byteLength,
          status: "DUPLICATE",
          error: "Pièce jointe déjà importée.",
        },
      });
      continue;
    }
    try {
      const documents = await createUploadedDocuments({
        organizationId: input.organizationId,
        userId: input.userId ?? (await fallbackUser(input.organizationId)),
        files: [{ filename: attachment.filename, mimeType: attachment.mimeType, bytes: attachment.bytes }],
      });
      const document = documents[0];
      await prisma.inboundAttachment.create({
        data: {
          organizationId: input.organizationId,
          messageId: message.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.bytes.byteLength,
          contentHash: hash,
          documentId: document.id,
          status: "COMPLETED",
        },
      });
      await enqueueDocumentProcessing(input.organizationId, document.id);
      created += 1;
    } catch (error) {
      rejected += 1;
      const reason = error instanceof Error ? error.message : "Pièce jointe refusée.";
      errors.push(reason);
      await prisma.inboundAttachment.create({
        data: {
          organizationId: input.organizationId,
          messageId: message.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.bytes.byteLength,
          status: "FAILED",
          error: reason,
        },
      });
    }
  }
  await prisma.inboundMessage.update({
    where: { id: message.id },
    data: { status: created > 0 ? "COMPLETED" : "FAILED", error: errors[0] ?? (duplicates > 0 ? "Pièce jointe déjà importée." : null) },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "inbound.received",
    entityType: "InboundMessage",
    entityId: message.id,
    newValue: { provider: input.provider, from: input.message.from, created, duplicates, rejected },
  });
  return { messageId: message.id, created, duplicates, rejected };
}

async function fallbackUser(organizationId: string) {
  const member = await prisma.organizationMember.findFirst({
    where: { organizationId, role: "OWNER" },
    select: { userId: true },
  });
  if (!member) throw new Error("Organisation sans propriétaire.");
  return member.userId;
}

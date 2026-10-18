import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

function loadEnv() {
  if (process.env.DATABASE_URL && process.env.AUTH_SECRET) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

loadEnv();

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;
const suffix = `life-${Date.now()}`;

describe("document lifecycle", () => {
  const organizationIds: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  it("processes, edits, validates, rejects and reprocesses inside one organization", async () => {
    if (!prisma) return;
    const { getStorage } = await import("@/services/storage");
    const { processDocument, rejectDocument, updateDocumentField, validateDocument } = await import("@/services/documents");
    const organization = await prisma.organization.create({ data: { name: `Cycle ${suffix}` } });
    const other = await prisma.organization.create({ data: { name: `Autre ${suffix}` } });
    organizationIds.push(organization.id, other.id);
    const user = await prisma.user.create({
      data: {
        name: "Cycle",
        email: `cycle.${suffix}@fluxora.test`,
        passwordHash: "not-used",
        activeOrganizationId: organization.id,
        memberships: { create: { organizationId: organization.id, role: "OWNER" } },
      },
    });
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const document = await prisma.document.create({
      data: {
        organizationId: organization.id,
        filename: "facture-fournisseur.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        storageKey: "pending",
      },
    });
    const storageKey = `organizations/${organization.id}/documents/${document.id}/original`;
    await getStorage().put(storageKey, bytes);
    await prisma.document.update({ where: { id: document.id }, data: { storageKey } });
    await prisma.job.create({
      data: { organizationId: organization.id, type: "PROCESS_DOCUMENT", payload: { documentId: document.id } },
    });

    await processDocument(document.id);
    const processed = await prisma.document.findFirst({
      where: { id: document.id, organizationId: organization.id },
      include: { fields: true },
    });
    expect(processed?.status === "PROCESSED" || processed?.status === "NEEDS_REVIEW").toBe(true);
    expect(processed?.fields.length).toBeGreaterThan(3);
    expect(processed?.storageKey.startsWith(`organizations/${organization.id}/`)).toBe(true);

    await updateDocumentField({
      organizationId: organization.id,
      userId: user.id,
      documentId: document.id,
      key: "invoice_number",
      value: "FAC-CYCLE-1",
    });
    const edited = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, documentId: document.id, action: "document.field_updated" },
    });
    expect(edited?.newValue).toMatchObject({ value: "FAC-CYCLE-1" });

    await validateDocument({ organizationId: organization.id, userId: user.id, documentId: document.id });
    const validated = await prisma.document.findFirst({ where: { id: document.id } });
    expect(validated?.status).toBe("VALIDATED");

    await processDocument(document.id);
    const reprocessed = await prisma.document.findFirst({
      where: { id: document.id },
      include: { fields: { where: { key: "invoice_number" } } },
    });
    expect(reprocessed?.status === "PROCESSED" || reprocessed?.status === "NEEDS_REVIEW").toBe(true);
    expect(reprocessed?.fields[0]?.value).toBe("FAC-CYCLE-1");
    expect(reprocessed?.fields[0]?.source).toBe("USER");
    const history = await prisma.documentProcessingRun.count({ where: { documentId: document.id } });
    expect(history).toBeGreaterThan(0);

    const second = await prisma.document.create({
      data: {
        organizationId: organization.id,
        filename: "facture-fournisseur-bis.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        storageKey: "pending",
      },
    });
    const secondKey = `organizations/${organization.id}/documents/${second.id}/original`;
    await getStorage().put(secondKey, bytes);
    await prisma.document.update({ where: { id: second.id }, data: { storageKey: secondKey } });
    await processDocument(second.id);
    await rejectDocument({
      organizationId: organization.id,
      userId: user.id,
      documentId: second.id,
      reason: "Doublon",
    });
    const rejected = await prisma.document.findFirst({ where: { id: second.id } });
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.rejectionReason).toBe("Doublon");

    const leaked = await prisma.document.findFirst({
      where: { id: document.id, organizationId: other.id, deletedAt: null },
    });
    const blocked = await prisma.document.updateMany({
      where: { id: document.id, organizationId: other.id },
      data: { filename: "fuite.pdf" },
    });
    expect(leaked).toBeNull();
    expect(blocked.count).toBe(0);
  }, 20_000);
});

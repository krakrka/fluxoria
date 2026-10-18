import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { createPennylaneConnector, pennylaneFixtureFetch } from "@/connectors/accounting/pennylane";
import { normalizeForwardedEmail } from "@/connectors/email/inbox";
import { createGoogleDriveProvider } from "@/connectors/files/google-drive";
import { findValidSirens, vatFromSiren } from "@/lib/siren";
import { zipStored } from "@/lib/zip";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(".env", "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

const databaseUrl = loadDatabaseUrl();
const prisma = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

describe("ingestion flow", () => {
  const suffix = `phase6-${Date.now()}`;
  let organizationId = "";
  let otherOrganizationId = "";
  let userId = "";

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { name: { in: [`Ingest ${suffix}`, `Ingest other ${suffix}`] } } });
    await prisma.user.deleteMany({ where: { email: `ingest-${suffix}@fluxora.test` } });
    await prisma.$disconnect();
  });

  it("turns an email attachment into one document and ignores a duplicate", async () => {
    if (!prisma) return;
    const user = await prisma.user.create({ data: { email: `ingest-${suffix}@fluxora.test`, name: "Inès", passwordHash: "test" } });
    const organization = await prisma.organization.create({ data: { name: `Ingest ${suffix}`, plan: "PRO" } });
    const other = await prisma.organization.create({ data: { name: `Ingest other ${suffix}`, plan: "PRO" } });
    await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    organizationId = organization.id;
    otherOrganizationId = other.id;
    userId = user.id;
    const { acceptInboundEmail } = await import("@/services/email-ingestion");
    const message = normalizeForwardedEmail({
      externalId: "mail-1",
      from: "achat@aciens.fr",
      recipient: "ignored-by-server",
      subject: "Facture",
      attachments: [{ filename: "facture-fournisseur.pdf", mimeType: "application/pdf", bytes: pdf }],
    });
    const first = await acceptInboundEmail({ organizationId, userId, provider: "FLUXORA_INBOX", message });
    const second = await acceptInboundEmail({ organizationId, userId, provider: "FLUXORA_INBOX", message });
    const third = await acceptInboundEmail({ organizationId: otherOrganizationId, userId, provider: "FLUXORA_INBOX", message: { ...message, recipient: "other" } });
    const visible = await prisma.inboundMessage.count({ where: { organizationId } });
    const hidden = await prisma.inboundMessage.count({ where: { organizationId: otherOrganizationId } });
    const documents = await prisma.document.count({ where: { organizationId, deletedAt: null } });
    const jobs = await prisma.job.count({ where: { organizationId, status: "RECEIVED" } });
    expect(first.created).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(second.created).toBe(0);
    expect(third.created).toBe(1);
    expect(documents).toBe(1);
    expect(visible).toBe(2);
    expect(hidden).toBe(1);
    expect(jobs).toBe(1);
  }, 20_000);

  it("imports a zip and rejects a text file inside it", async () => {
    if (!prisma || !organizationId) return;
    const { importBulkDocuments } = await import("@/services/bulk-import");
    const archive = zipStored([
      { name: "facture-fournisseur.pdf", bytes: pdf },
      { name: "notes.txt", bytes: Buffer.from("bonjour") },
    ]);
    const result = await importBulkDocuments({
      organizationId,
      userId,
      files: [{ filename: "lot.zip", mimeType: "application/zip", bytes: archive }],
    });
    expect(result.accepted.map((item) => item.filename)).toContain("facture-fournisseur.pdf");
    expect(result.rejected.some((item) => item.filename === "notes.txt")).toBe(true);
  }, 20_000);

  it("imports a valid supplier and skips the duplicate", async () => {
    if (!prisma || !organizationId) return;
    const { commitCsv } = await import("@/services/csv-import");
    const siren = findValidSirens(1, 200000000)[0];
    const csv = `nom,siren,tva\nAtelier CSV,${siren},${vatFromSiren(siren)}`;
    const first = await commitCsv({ organizationId, userId, kind: "suppliers", text: csv });
    const second = await commitCsv({ organizationId, userId, kind: "suppliers", text: csv });
    expect(first.imported).toBe(1);
    expect(second.skipped).toBe(1);
    const leaked = await prisma.supplier.count({ where: { organizationId: otherOrganizationId, name: "Atelier CSV" } });
    expect(leaked).toBe(0);
  });

  it("syncs Pennylane through InvoiceService and exports only a validated invoice", async () => {
    if (!prisma || !organizationId) return;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "fluxora-test-secret-value";
    const { syncAccounting } = await import("@/services/accounting-sync");
    const { exportValidatedInvoice } = await import("@/services/invoices");
    const connector = createPennylaneConnector(pennylaneFixtureFetch());
    await prisma.connectorAccount.create({
      data: { organizationId, provider: "PENNYLANE", status: "CONNECTED", settings: { transport: "fixture" } },
    });
    const synced = await syncAccounting({ organizationId, userId, connector, token: "fixture" });
    expect(synced.supplierCount).toBe(1);
    expect(synced.invoiceCount).toBe(1);
    const invoice = await prisma.invoice.findFirst({ where: { organizationId, number: "PL-100" } });
    expect(invoice).toBeTruthy();
    await expect(exportValidatedInvoice({ organizationId, userId, invoiceId: invoice!.id, connector, token: "fixture" })).rejects.toThrow(/validée/);
    await prisma.invoice.update({ where: { id: invoice!.id }, data: { status: "VALIDATED" } });
    await expect(exportValidatedInvoice({ organizationId, userId, invoiceId: invoice!.id, connector, token: "fixture" })).resolves.toEqual({ externalId: "exported-1" });
    const again = await syncAccounting({ organizationId, userId, connector, token: "fixture" });
    expect(again.invoiceCount).toBe(0);
  });

  it("retries a failed job with a journal, then stops", async () => {
    if (!prisma || !organizationId) return;
    const { promoteDueJobs, retryJobManually, runJob } = await import("@/services/queue");
    const job = await prisma.job.create({
      data: { organizationId, type: "PROCESS_DOCUMENT", payload: { documentId: "missing-document" }, status: "RECEIVED" },
    });
    await runJob(job.id);
    const retrying = await prisma.job.findUnique({ where: { id: job.id } });
    expect(retrying?.status).toBe("RETRYING");
    expect(Array.isArray(retrying?.errorLog)).toBe(true);
    await promoteDueJobs(new Date(Date.now() + 50));
    const second = await prisma.job.findUnique({ where: { id: job.id } });
    expect(second?.attempts).toBe(2);
    expect(second?.status).toBe("RETRYING");
    await promoteDueJobs(new Date());
    const stillWaiting = await prisma.job.findUnique({ where: { id: job.id } });
    expect(stillWaiting?.status).toBe("RETRYING");
    await promoteDueJobs(new Date(Date.now() + 20_000));
    const failed = await prisma.job.findUnique({ where: { id: job.id } });
    expect(failed?.status).toBe("FAILED");
    await expect(retryJobManually(otherOrganizationId, job.id)).rejects.toThrow(/introuvable/);
    await retryJobManually(organizationId, job.id);
    const manual = await prisma.job.findUnique({ where: { id: job.id } });
    expect(manual?.status).toBe("RETRYING");
    expect(manual?.attempts).toBe(1);
  }, 20_000);

  it("reclaims a stale processing job and leaves a fresh one alone", async () => {
    if (!prisma || !organizationId) return;
    const { promoteDueJobs } = await import("@/services/queue");
    const stale = await prisma.job.create({
      data: {
        organizationId,
        type: "PROCESS_DOCUMENT",
        payload: { documentId: "missing-stale" },
        status: "PROCESSING",
        attempts: 1,
        startedAt: new Date(Date.now() - 16 * 60 * 1000),
      },
    });
    const fresh = await prisma.job.create({
      data: {
        organizationId,
        type: "PROCESS_DOCUMENT",
        payload: { documentId: "missing-fresh" },
        status: "PROCESSING",
        attempts: 1,
        startedAt: new Date(),
      },
    });
    await promoteDueJobs(new Date());
    expect((await prisma.job.findUnique({ where: { id: stale.id } }))?.status).not.toBe("PROCESSING");
    expect((await prisma.job.findUnique({ where: { id: fresh.id } }))?.status).toBe("PROCESSING");
  });

  it("imports a Drive file into the organization pipeline", async () => {
    if (!prisma || !organizationId) return;
    const { importFileSource } = await import("@/services/file-import");
    const provider = createGoogleDriveProvider(async (input) => {
      const url = String(input);
      if (url.includes("alt=media")) return new Response(pdf);
      if (url.includes("/files/drive-1")) return Response.json({ name: "drive-facture.pdf", mimeType: "application/pdf" });
      return Response.json({ files: [{ id: "drive-1", name: "drive-facture.pdf", mimeType: "application/pdf" }] });
    });
    const result = await importFileSource({ organizationId, userId, provider, accessToken: "token" });
    expect(result.accepted).toContain("drive-facture.pdf");
    const foreign = await prisma.document.count({ where: { organizationId: otherOrganizationId, filename: "drive-facture.pdf" } });
    expect(foreign).toBe(0);
  }, 20_000);

  it("deletes an unreferenced upload when the transaction fails and keeps a referenced file", async () => {
    if (!prisma || !organizationId) return;
    const { mkdtemp, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const path = await import("path");
    const { LocalStorageProvider } = await import("@/services/storage");
    const { createUploadedDocuments } = await import("@/services/documents");
    const { reconcileLocalUnreferenced } = await import("@/services/storage");
    const root = await mkdtemp(path.join(tmpdir(), "fluxora-orphan-"));
    const storage = new LocalStorageProvider(root);
    const orphanKey = `organizations/${organizationId}/documents/orphanfile/original`;
    const keptKey = `organizations/${organizationId}/documents/keptfile/original`;
    const foreignKey = `organizations/${otherOrganizationId}/documents/foreignfile/original`;
    try {
      await expect(createUploadedDocuments({
        organizationId,
        userId,
        storage,
        files: [
          { filename: "ok.pdf", mimeType: "application/pdf", bytes: pdf },
          { filename: "bad.txt", mimeType: "text/plain", bytes: Buffer.from("nope") },
        ],
      })).rejects.toThrow(/Format/);
      expect(await prisma.document.count({ where: { organizationId, filename: "ok.pdf" } })).toBe(0);
      await storage.put(orphanKey, pdf);
      await storage.put(keptKey, pdf);
      await storage.put(foreignKey, pdf);
      const kept = await prisma.document.create({
        data: {
          organizationId,
          uploadedById: userId,
          filename: "kept.pdf",
          mimeType: "application/pdf",
          sizeBytes: pdf.byteLength,
          storageKey: keptKey,
          status: "RECEIVED",
        },
      });
      const removed = await reconcileLocalUnreferenced(root, organizationId, async (key) => {
        return (await prisma.document.count({ where: { organizationId, storageKey: key } })) > 0;
      });
      expect(removed).toEqual([orphanKey]);
      expect((await storage.get(keptKey)).equals(pdf)).toBe(true);
      expect((await storage.get(foreignKey)).equals(pdf)).toBe(true);
      await prisma.document.delete({ where: { id: kept.id } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { findValidSirens, vatFromSiren } from "@/lib/siren";
import { buildSimplePdf } from "@/services/pdf";

const DATABASE_NAME = "fluxora_effect_test";
const savedDatabaseUrl = process.env.DATABASE_URL;

function databaseUrl() {
  const raw = savedDatabaseUrl || envValue("DATABASE_URL");
  if (!raw) throw new Error("DATABASE_URL est absent. La base isolée n'est pas prouvée.");
  const url = new URL(raw);
  url.pathname = `/${DATABASE_NAME}`;
  return url.toString();
}

function envValue(name: string) {
  const text = readFileSync(".env", "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1).replace(/^"|"$/g, "");
}

function redact(text: string) {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted");
}

function ensureIsolatedDatabase() {
  let listed = "";
  try {
    listed = execFileSync(
      "docker",
      ["exec", "fluxora-postgres", "psql", "-U", "fluxora", "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${DATABASE_NAME}'`],
      { encoding: "utf8" },
    ).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : "docker";
    throw new Error(`PostgreSQL local indisponible. Les tests d'effets de bord ne sont pas validés. ${redact(message)}`);
  }
  if (listed === "1") return;
  execFileSync("docker", ["exec", "fluxora-postgres", "createdb", "-U", "fluxora", DATABASE_NAME], { stdio: "pipe" });
}

function migrateIsolatedDatabase(url: string) {
  try {
    execFileSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`Migration de la base isolée impossible. ${redact(stderr)}`);
  }
}

function syntheticInvoice() {
  const siren = findValidSirens(1)[0];
  return buildSimplePdf([
    "FACTURE",
    "Facture no FAC-SYN-1",
    "Date : 12/03/2026",
    "Echeance : 11/11/2026",
    "Fournisseur : Atelier Synthetique",
    `SIREN : ${siren}`,
    `TVA intra : ${vatFromSiren(siren)}`,
    "Client : Client Synthetique",
    "Devise : EUR",
    "Conditions : 30 jours",
    "LIGNE Fourniture | 2 | 50.00 | 20 | 100.00",
    "Total HT : 100.00",
    "TVA : 20.00",
    "Total TTC : 120.00",
  ]);
}

describe("processing lease side effects", () => {
  const suffix = `effect-${Date.now()}`;
  const organizationIds: string[] = [];
  const storageRoot = mkdtempSync(join(tmpdir(), "fluxora-effect-"));

  beforeAll(() => {
    ensureIsolatedDatabase();
    const url = databaseUrl();
    process.env.DATABASE_URL = url;
    migrateIsolatedDatabase(url);
    const globalForPrisma = globalThis as { prisma?: { $disconnect: () => Promise<void> } };
    delete globalForPrisma.prisma;
  }, 120_000);

  afterEach(async () => {
    const { setProcessingBeforePersistForTests } = await import("@/services/documents");
    setProcessingBeforePersistForTests(null);
  });

  afterAll(async () => {
    const { prisma } = await import("@/server/db");
    const { setProcessingBeforePersistForTests } = await import("@/services/documents");
    setProcessingBeforePersistForTests(null);
    if (organizationIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await prisma.$disconnect();
    const globalForPrisma = globalThis as { prisma?: unknown };
    delete globalForPrisma.prisma;
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    rmSync(storageRoot, { recursive: true, force: true });
  });

  async function seedPair() {
    const { prisma } = await import("@/server/db");
    const { LocalStorageProvider } = await import("@/services/storage");
    const storage = new LocalStorageProvider(storageRoot);
    const owner = await prisma.organization.create({ data: { name: `Effect ${suffix} ${organizationIds.length}`, plan: "STARTER" } });
    const other = await prisma.organization.create({ data: { name: `EffectOther ${suffix} ${organizationIds.length}`, plan: "STARTER" } });
    organizationIds.push(owner.id, other.id);
    const bytes = syntheticInvoice();
    const document = await prisma.document.create({
      data: {
        organizationId: owner.id,
        filename: "facture-synthetique.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        storageKey: "pending",
        status: "RECEIVED",
      },
    });
    const storageKey = `organizations/${owner.id}/documents/${document.id}/original`;
    await storage.put(storageKey, bytes);
    await prisma.document.update({ where: { id: document.id }, data: { storageKey } });
    const untouched = await prisma.document.create({
      data: {
        organizationId: other.id,
        filename: "untouched.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `organizations/${other.id}/documents/untouched/original`,
        status: "RECEIVED",
      },
    });
    const startedAt = new Date();
    const job = await prisma.job.create({
      data: {
        organizationId: owner.id,
        type: "PROCESS_DOCUMENT",
        payload: { documentId: document.id },
        status: "PROCESSING",
        attempts: 1,
        startedAt,
      },
    });
    return { storage, ownerId: owner.id, otherId: other.id, documentId: document.id, untouchedId: untouched.id, jobId: job.id, startedAt };
  }

  it("drops the old worker's writes when its lease expires during extraction", async () => {
    const { prisma } = await import("@/server/db");
    const { processDocument, setProcessingBeforePersistForTests, ProcessingLeaseLost } = await import("@/services/documents");
    const seeded = await seedPair();
    const snapshot = { invoiceId: "", usage: 0, processedAudits: 0, notifications: 0, events: 0, anomalies: 0 };
    setProcessingBeforePersistForTests(async () => {
      setProcessingBeforePersistForTests(null);
      const restarted = new Date();
      await prisma.job.update({ where: { id: seeded.jobId }, data: { startedAt: restarted } });
      await processDocument(seeded.documentId, {
        organizationId: seeded.ownerId,
        continueProcessing: true,
        storage: seeded.storage,
        lease: { jobId: seeded.jobId, startedAt: restarted },
      });
      const invoice = await prisma.invoice.findFirst({ where: { documentId: seeded.documentId, organizationId: seeded.ownerId } });
      snapshot.invoiceId = invoice?.id ?? "";
      snapshot.usage = await prisma.aiUsage.count({ where: { documentId: seeded.documentId } });
      snapshot.processedAudits = await prisma.auditLog.count({ where: { documentId: seeded.documentId, action: "document.processed" } });
      snapshot.notifications = await prisma.notification.count({ where: { organizationId: seeded.ownerId } });
      snapshot.events = await prisma.productEvent.count({ where: { organizationId: seeded.ownerId, name: "document_processed" } });
      snapshot.anomalies = invoice ? await prisma.anomaly.count({ where: { invoiceId: invoice.id } }) : 0;
    });
    await expect(processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: seeded.startedAt },
    })).rejects.toBeInstanceOf(ProcessingLeaseLost);
    const invoices = await prisma.invoice.findMany({ where: { documentId: seeded.documentId, organizationId: seeded.ownerId } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.id).toBe(snapshot.invoiceId);
    expect(snapshot.usage).toBe(1);
    expect(await prisma.aiUsage.count({ where: { documentId: seeded.documentId } })).toBe(snapshot.usage);
    expect(await prisma.auditLog.count({ where: { documentId: seeded.documentId, action: "document.processed" } })).toBe(snapshot.processedAudits);
    expect(await prisma.notification.count({ where: { organizationId: seeded.ownerId } })).toBe(snapshot.notifications);
    expect(await prisma.productEvent.count({ where: { organizationId: seeded.ownerId, name: "document_processed" } })).toBe(snapshot.events);
    expect(await prisma.anomaly.count({ where: { invoiceId: snapshot.invoiceId } })).toBe(snapshot.anomalies);
    expect((await prisma.document.findUnique({ where: { id: seeded.untouchedId } }))?.status).toBe("RECEIVED");
    expect(await prisma.invoice.count({ where: { organizationId: seeded.otherId } })).toBe(0);
    expect(await prisma.aiUsage.count({ where: { organizationId: seeded.otherId } })).toBe(0);
  });

  it("refuses every persistent write once the lease no longer matches", async () => {
    const { prisma } = await import("@/server/db");
    const { processDocument, ProcessingLeaseLost } = await import("@/services/documents");
    const seeded = await seedPair();
    await processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: seeded.startedAt },
    });
    const before = {
      status: (await prisma.document.findUnique({ where: { id: seeded.documentId } }))?.status,
      invoiceId: (await prisma.invoice.findFirst({ where: { documentId: seeded.documentId } }))?.id,
      usage: await prisma.aiUsage.count({ where: { documentId: seeded.documentId } }),
      audits: await prisma.auditLog.count({ where: { documentId: seeded.documentId } }),
      notifications: await prisma.notification.count({ where: { organizationId: seeded.ownerId } }),
    };
    await prisma.job.update({ where: { id: seeded.jobId }, data: { startedAt: new Date() } });
    const foreignStarted = new Date();
    const foreign = await prisma.job.create({
      data: {
        organizationId: seeded.otherId,
        type: "PROCESS_DOCUMENT",
        payload: { documentId: seeded.documentId },
        status: "PROCESSING",
        attempts: 1,
        startedAt: foreignStarted,
      },
    });
    await expect(processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      continueProcessing: true,
      storage: seeded.storage,
      lease: { jobId: foreign.id, startedAt: foreignStarted },
    })).rejects.toBeInstanceOf(ProcessingLeaseLost);
    await expect(processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      continueProcessing: true,
      finalAttempt: true,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: seeded.startedAt },
    })).rejects.toBeInstanceOf(ProcessingLeaseLost);
    expect((await prisma.document.findUnique({ where: { id: seeded.documentId } }))?.status).toBe(before.status);
    expect((await prisma.invoice.findFirst({ where: { documentId: seeded.documentId } }))?.id).toBe(before.invoiceId);
    expect(await prisma.aiUsage.count({ where: { documentId: seeded.documentId } })).toBe(before.usage);
    expect(await prisma.auditLog.count({ where: { documentId: seeded.documentId } })).toBe(before.audits);
    expect(await prisma.notification.count({ where: { organizationId: seeded.ownerId } })).toBe(before.notifications);
    expect((await prisma.document.findUnique({ where: { id: seeded.untouchedId } }))?.status).toBe("RECEIVED");
    expect(await prisma.invoice.count({ where: { organizationId: seeded.otherId } })).toBe(0);
  });

  it("keeps a single invoice when processing restarts after a crash before the job is finished", async () => {
    const { prisma } = await import("@/server/db");
    const { processDocument } = await import("@/services/documents");
    const seeded = await seedPair();
    await processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: seeded.startedAt },
    });
    const firstId = (await prisma.invoice.findFirst({ where: { documentId: seeded.documentId } }))?.id;
    const restarted = new Date(Date.now() - 16 * 60 * 1000);
    await prisma.job.update({ where: { id: seeded.jobId }, data: { startedAt: restarted } });
    const staleFinish = await prisma.job.updateMany({
      where: { id: seeded.jobId, status: "PROCESSING", startedAt: seeded.startedAt },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
    expect(staleFinish.count).toBe(0);
    const resumed = new Date();
    await prisma.job.update({ where: { id: seeded.jobId }, data: { startedAt: resumed, status: "PROCESSING" } });
    await processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      continueProcessing: true,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: resumed },
    });
    const invoices = await prisma.invoice.findMany({ where: { documentId: seeded.documentId, organizationId: seeded.ownerId } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.id).not.toBe(firstId);
    const fields = await prisma.documentField.findMany({ where: { documentId: seeded.documentId, key: "invoice_number" } });
    expect(fields).toHaveLength(1);
    expect(await prisma.supplier.count({ where: { organizationId: seeded.ownerId } })).toBe(1);
    expect(await prisma.customer.count({ where: { organizationId: seeded.ownerId } })).toBe(1);
    expect((await prisma.document.findUnique({ where: { id: seeded.untouchedId } }))?.status).toBe("RECEIVED");
    expect(await prisma.invoice.count({ where: { organizationId: seeded.otherId } })).toBe(0);
  });

  it("replays a committed document without duplicating the same business facts", async () => {
    const { prisma } = await import("@/server/db");
    const { processDocument } = await import("@/services/documents");
    const seeded = await seedPair();
    await prisma.automationRule.create({
      data: {
        organizationId: seeded.ownerId,
        name: "Relance atelier",
        trigger: "DOCUMENT_PROCESSED",
        conditions: { all: [{ field: "supplierName", op: "contains", value: "Atelier Synthetique" }] },
        actions: [{ type: "create_reminder_task" }],
      },
    });
    await processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: seeded.startedAt },
    });
    const first = await factCounts(seeded.ownerId, seeded.documentId);
    expect(first).toEqual({ reminders: 1, outcome: 1, executions: 1, events: 1, processedAudits: 1 });
    await prisma.job.update({ where: { id: seeded.jobId }, data: { startedAt: new Date(Date.now() - 16 * 60 * 1000) } });
    const staleFinish = await prisma.job.updateMany({
      where: { id: seeded.jobId, status: "PROCESSING", startedAt: seeded.startedAt },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
    expect(staleFinish.count).toBe(0);
    const resumed = new Date();
    await prisma.job.update({ where: { id: seeded.jobId }, data: { startedAt: resumed, status: "PROCESSING" } });
    await processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      continueProcessing: true,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: resumed },
    });
    expect(await factCounts(seeded.ownerId, seeded.documentId)).toEqual(first);
    expect(await prisma.invoice.count({ where: { documentId: seeded.documentId, organizationId: seeded.ownerId } })).toBe(1);

    await prisma.automationRule.create({
      data: {
        organizationId: seeded.ownerId,
        name: "Relance client",
        trigger: "DOCUMENT_PROCESSED",
        conditions: { all: [{ field: "customerName", op: "contains", value: "Client Synthetique" }] },
        actions: [{ type: "create_reminder_task" }],
      },
    });
    const again = new Date();
    await prisma.job.update({ where: { id: seeded.jobId }, data: { startedAt: again, status: "PROCESSING" } });
    await processDocument(seeded.documentId, {
      organizationId: seeded.ownerId,
      continueProcessing: true,
      storage: seeded.storage,
      lease: { jobId: seeded.jobId, startedAt: again },
    });
    const afterNewRule = await factCounts(seeded.ownerId, seeded.documentId);
    expect(afterNewRule.reminders).toBe(2);
    expect(afterNewRule.executions).toBe(2);
    expect(afterNewRule.outcome).toBe(1);
    expect(afterNewRule.events).toBe(1);
    expect(afterNewRule.processedAudits).toBe(1);

    const bytes = syntheticInvoice();
    const otherDocument = await prisma.document.create({
      data: {
        organizationId: seeded.ownerId,
        filename: "facture-distincte.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        storageKey: "pending",
        status: "RECEIVED",
      },
    });
    const storageKey = `organizations/${seeded.ownerId}/documents/${otherDocument.id}/original`;
    await seeded.storage.put(storageKey, bytes);
    await prisma.document.update({ where: { id: otherDocument.id }, data: { storageKey } });
    const otherStarted = new Date();
    const otherJob = await prisma.job.create({
      data: {
        organizationId: seeded.ownerId,
        type: "PROCESS_DOCUMENT",
        payload: { documentId: otherDocument.id },
        status: "PROCESSING",
        attempts: 1,
        startedAt: otherStarted,
      },
    });
    await processDocument(otherDocument.id, {
      organizationId: seeded.ownerId,
      storage: seeded.storage,
      lease: { jobId: otherJob.id, startedAt: otherStarted },
    });
    expect(await factCounts(seeded.ownerId, seeded.documentId)).toEqual(afterNewRule);
    const distinct = await factCounts(seeded.ownerId, otherDocument.id);
    expect(distinct).toEqual({ reminders: 2, outcome: 1, executions: 2, events: 1, processedAudits: 1 });
    expect(await prisma.notification.count({ where: { organizationId: seeded.otherId } })).toBe(0);
    expect(await prisma.workflowExecution.count({ where: { organizationId: seeded.otherId } })).toBe(0);
    expect(await prisma.productEvent.count({ where: { organizationId: seeded.otherId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: seeded.otherId, action: "document.processed" } })).toBe(0);
    expect((await prisma.document.findUnique({ where: { id: seeded.untouchedId } }))?.status).toBe("RECEIVED");
  });
});

async function factCounts(organizationId: string, documentId: string) {
  const { prisma } = await import("@/server/db");
  const [reminders, outcome, executions, events, processedAudits] = await Promise.all([
    prisma.notification.count({ where: { organizationId, title: "Relance à préparer", dedupeKey: { contains: documentId } } }),
    prisma.notification.count({ where: { organizationId, dedupeKey: `document.processing_outcome:${documentId}` } }),
    prisma.workflowExecution.count({ where: { organizationId, documentId } }),
    prisma.productEvent.count({ where: { organizationId, dedupeKey: `document_processed:${documentId}` } }),
    prisma.auditLog.count({ where: { organizationId, dedupeKey: `document.processed:${documentId}` } }),
  ]);
  return { reminders, outcome, executions, events, processedAudits };
}

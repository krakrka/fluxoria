import "server-only";
import { existsSync } from "node:fs";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { publicErrorMessage } from "@/lib/security";
import { ProcessingLeaseLost, processDocument } from "@/services/documents";
import { prisma } from "@/server/db";

export const MAX_JOB_ATTEMPTS = 3;
export const JOB_BACKOFF_MS = [0, 2_000, 8_000];
export const STALE_RECEIVED_MS = 2 * 60 * 1000;
export const STALE_PROCESSING_MS = 15 * 60 * 1000;

type ErrorEntry = { at: string; attempt: number; message: string };

export async function enqueueDocumentProcessing(organizationId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!document) throw new Error("Document introuvable.");
  const job = await prisma.job.create({
    data: {
      organizationId,
      type: "PROCESS_DOCUMENT",
      payload: { documentId },
      status: "RECEIVED",
    },
  });
  schedule(job.id, 0);
  return job.id;
}

function testJobMode(): "ok" | "fail" | "hold" | null {
  if (process.env.NODE_ENV === "production") return null;
  const mode = process.env.JOB_TEST_MODE;
  if (mode === "ok" || mode === "fail" || mode === "hold") return mode;
  return null;
}

async function holdForTestGate() {
  const gate = process.env.JOB_HOLD_GATE;
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (gate && existsSync(gate)) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function finishJob(id: string, startedAt: Date, data: Record<string, unknown>) {
  const marked = await prisma.job.updateMany({
    where: { id, status: "PROCESSING", startedAt },
    data,
  });
  return marked.count === 1;
}

export async function runJob(jobId: string) {
  const current = await prisma.job.findUnique({ where: { id: jobId } });
  if (!current || current.status === "COMPLETED" || current.status === "PROCESSING") return;
  const startedAt = new Date();
  const claimed = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ["RECEIVED", "RETRYING"] } },
    data: { status: "PROCESSING", startedAt, attempts: { increment: 1 }, nextAttemptAt: null },
  });
  if (claimed.count === 0) return;
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  const payload = job.payload as { documentId?: string };
  try {
    const mode = testJobMode();
    if (mode === "hold") await holdForTestGate();
    else if (mode === "fail") throw new Error("job_test_failed");
    else if (mode !== "ok" && job.type === "PROCESS_DOCUMENT" && payload.documentId) {
      await processDocument(payload.documentId, {
        organizationId: job.organizationId,
        continueProcessing: job.attempts > 1,
        finalAttempt: job.attempts >= MAX_JOB_ATTEMPTS,
        lease: { jobId: job.id, startedAt },
      });
    }
    const marked = await finishJob(job.id, startedAt, { status: "COMPLETED", finishedAt: new Date(), error: null });
    if (!marked) logger.warn("job_lease_lost", { jobId });
  } catch (error) {
    if (error instanceof ProcessingLeaseLost || (error instanceof Error && error.message === "Bail de traitement perdu.")) {
      logger.warn("job_lease_lost", { jobId });
      return;
    }
    const message = publicErrorMessage(error, "Traitement interrompu.");
    const history = Array.isArray(job.errorLog) ? (job.errorLog as ErrorEntry[]) : [];
    const errorLog = [...history, { at: new Date().toISOString(), attempt: job.attempts, message }];
    logger.error("job_failed", { jobId, error: message, attempt: job.attempts });
    if (job.attempts < MAX_JOB_ATTEMPTS) {
      const delay = JOB_BACKOFF_MS[Math.min(job.attempts - 1, JOB_BACKOFF_MS.length - 1)] ?? 8_000;
      const marked = await finishJob(job.id, startedAt, {
        status: "RETRYING",
        error: message,
        errorLog,
        nextAttemptAt: new Date(Date.now() + delay),
        finishedAt: null,
      });
      if (!marked) {
        logger.warn("job_lease_lost", { jobId });
        return;
      }
      schedule(job.id, delay);
      return;
    }
    const marked = await finishJob(job.id, startedAt, { status: "FAILED", finishedAt: new Date(), error: message, errorLog });
    if (!marked) logger.warn("job_lease_lost", { jobId });
  }
}

export async function promoteDueJobs(asOf = new Date()) {
  const processingDeadline = new Date(asOf.getTime() - STALE_PROCESSING_MS);
  const receivedDeadline = new Date(asOf.getTime() - STALE_RECEIVED_MS);
  const staleProcessing = { status: "PROCESSING" as const, OR: [{ startedAt: null }, { startedAt: { lte: processingDeadline } }] };
  await prisma.job.updateMany({
    where: { ...staleProcessing, attempts: { lt: MAX_JOB_ATTEMPTS } },
    data: { status: "RETRYING", nextAttemptAt: asOf },
  });
  await prisma.job.updateMany({
    where: { ...staleProcessing, attempts: { gte: MAX_JOB_ATTEMPTS } },
    data: { status: "FAILED", finishedAt: asOf, error: "Traitement interrompu." },
  });
  const due = await prisma.job.findMany({
    where: {
      OR: [
        { status: "RETRYING" as const, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: asOf } }] },
        { status: "RECEIVED" as const, createdAt: { lte: receivedDeadline } },
      ],
    },
    take: 20,
    select: { id: true },
  });
  for (const job of due) await runJob(job.id);
  return due.length;
}

export async function jobHealth(now = new Date()) {
  const processingDeadline = new Date(now.getTime() - STALE_PROCESSING_MS);
  const [received, processing, stale, retrying, failed, oldestReceived] = await Promise.all([
    prisma.job.count({ where: { status: "RECEIVED" } }),
    prisma.job.count({ where: { status: "PROCESSING", startedAt: { gt: processingDeadline } } }),
    prisma.job.count({ where: { status: "PROCESSING", OR: [{ startedAt: null }, { startedAt: { lte: processingDeadline } }] } }),
    prisma.job.count({ where: { status: "RETRYING" } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.job.findFirst({ where: { status: "RECEIVED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const oldestReceivedAgeSeconds = oldestReceived
    ? Math.max(0, Math.floor((now.getTime() - oldestReceived.createdAt.getTime()) / 1000))
    : null;
  if (stale > 0 || failed > 0) logger.warn("job_stuck", { received, processing, stale, retrying, failed });
  return { received, processing, stale, retrying, failed, oldestReceivedAgeSeconds };
}

export async function retryJobManually(organizationId: string, jobId: string) {
  const updated = await prisma.job.updateMany({
    where: { id: jobId, organizationId, status: { in: ["FAILED", "RETRYING"] } },
    data: { status: "RECEIVED", attempts: 0, error: null, nextAttemptAt: null, finishedAt: null },
  });
  if (updated.count === 0) throw new Error("Job introuvable pour cette organisation.");
  await runJob(jobId);
}

export async function runJobNow(organizationId: string, documentId: string) {
  const job = await prisma.job.create({
    data: {
      organizationId,
      type: "PROCESS_DOCUMENT",
      payload: { documentId },
      status: "RECEIVED",
    },
  });
  await runJob(job.id);
}

function schedule(jobId: string, delay: number) {
  if (process.env.VITEST) return;
  after(async () => {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    await runJob(jobId);
  });
}

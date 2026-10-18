import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const DATABASE_NAME = "fluxora_job_test";
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
    throw new Error(`PostgreSQL local indisponible. Les tests de jobs ne sont pas validés. ${redact(message)}`);
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

describe("job recovery", () => {
  const suffix = `job-${Date.now()}`;
  const organizationIds: string[] = [];

  beforeAll(() => {
    ensureIsolatedDatabase();
    const url = databaseUrl();
    process.env.DATABASE_URL = url;
    migrateIsolatedDatabase(url);
    const globalForPrisma = globalThis as { prisma?: { $disconnect: () => Promise<void> } };
    delete globalForPrisma.prisma;
  }, 120_000);

  afterEach(() => {
    delete process.env.JOB_TEST_MODE;
    delete process.env.JOB_HOLD_GATE;
  });

  afterAll(async () => {
    const { prisma } = await import("@/server/db");
    if (organizationIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await prisma.$disconnect();
    const globalForPrisma = globalThis as { prisma?: unknown };
    delete globalForPrisma.prisma;
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    delete process.env.JOB_TEST_MODE;
    delete process.env.JOB_HOLD_GATE;
  });

  async function seedOrganization(label: string) {
    const { prisma } = await import("@/server/db");
    const organization = await prisma.organization.create({ data: { name: `JobRecover ${suffix} ${label}`, plan: "STARTER" } });
    organizationIds.push(organization.id);
    return organization.id;
  }

  async function seedJob(organizationId: string, status: "RECEIVED" | "PROCESSING", timing: { createdAt?: Date; startedAt?: Date | null; attempts?: number }) {
    const { prisma } = await import("@/server/db");
    return prisma.job.create({
      data: {
        organizationId,
        type: "PROCESS_DOCUMENT",
        payload: { documentId: `synthetic-${organizationId}` },
        status,
        attempts: timing.attempts ?? (status === "PROCESSING" ? 1 : 0),
        createdAt: timing.createdAt,
        startedAt: timing.startedAt,
      },
    });
  }

  function runProcess(script: string, extra: Record<string, string> = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl(), ...extra };
    delete env.ALERT_WEBHOOK_URL;
    delete env.ERROR_TRACKING_URL;
    env.EMAIL_DELIVERY_ENABLED = "";
    env.EMAIL_API_URL = "";
    env.EMAIL_API_KEY = "";
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", script], {
        cwd: process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr: redact(stderr) }));
    });
  }

  it("recovers an old received job without opening the admin page and leaves another organization alone", async () => {
    const { STALE_RECEIVED_MS, promoteDueJobs } = await import("@/services/queue");
    const { prisma } = await import("@/server/db");
    process.env.JOB_TEST_MODE = "ok";
    const owner = await seedOrganization("owner");
    const other = await seedOrganization("other");
    const document = await prisma.document.create({
      data: {
        organizationId: other,
        filename: "untouched.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: `organizations/${other}/documents/synthetic/original`,
        status: "RECEIVED",
      },
    });
    const due = await seedJob(owner, "RECEIVED", { createdAt: new Date(Date.now() - STALE_RECEIVED_MS - 1_000) });
    const fresh = await seedJob(other, "RECEIVED", { createdAt: new Date() });
    const live = await seedJob(other, "PROCESSING", { startedAt: new Date(), attempts: 1 });
    await promoteDueJobs();
    const recovered = await prisma.job.findUnique({ where: { id: due.id } });
    expect(recovered?.status).toBe("COMPLETED");
    expect(recovered?.attempts).toBe(1);
    expect((await prisma.job.findUnique({ where: { id: fresh.id } }))?.status).toBe("RECEIVED");
    expect((await prisma.job.findUnique({ where: { id: live.id } }))?.status).toBe("PROCESSING");
    expect((await prisma.document.findUnique({ where: { id: document.id } }))?.status).toBe("RECEIVED");
    expect(await prisma.job.count({ where: { organizationId: other, status: "COMPLETED" } })).toBe(0);
  });

  it("reclaims a processing job after the fifteen-minute mark and leaves a fresh one", async () => {
    const { STALE_PROCESSING_MS, promoteDueJobs } = await import("@/services/queue");
    const { prisma } = await import("@/server/db");
    process.env.JOB_TEST_MODE = "ok";
    const owner = await seedOrganization("stale");
    const stale = await seedJob(owner, "PROCESSING", { startedAt: new Date(Date.now() - STALE_PROCESSING_MS - 1_000), attempts: 1 });
    const fresh = await seedJob(owner, "PROCESSING", { startedAt: new Date(), attempts: 1 });
    await promoteDueJobs();
    expect((await prisma.job.findUnique({ where: { id: stale.id } }))?.status).toBe("COMPLETED");
    expect((await prisma.job.findUnique({ where: { id: stale.id } }))?.attempts).toBe(2);
    expect((await prisma.job.findUnique({ where: { id: fresh.id } }))?.status).toBe("PROCESSING");
  });

  it("lets only one of two processes claim the same received job", async () => {
    const { STALE_RECEIVED_MS } = await import("@/services/queue");
    const { prisma } = await import("@/server/db");
    const owner = await seedOrganization("race");
    const due = await seedJob(owner, "RECEIVED", { createdAt: new Date(Date.now() - STALE_RECEIVED_MS - 1_000) });
    const [first, second] = await Promise.all([
      runProcess("tests/fixtures/job-recover-process.ts", { JOB_TEST_MODE: "ok" }),
      runProcess("tests/fixtures/job-recover-process.ts", { JOB_TEST_MODE: "ok" }),
    ]);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const job = await prisma.job.findUnique({ where: { id: due.id } });
    expect(job?.status).toBe("COMPLETED");
    expect(job?.attempts).toBe(1);
    expect(first.stdout + second.stdout + first.stderr + second.stderr).not.toMatch(/postgres(?:ql)?:\/\//i);
  }, 40_000);

  it("stops an expired worker from finishing a job claimed by another process", async () => {
    const { STALE_PROCESSING_MS, STALE_RECEIVED_MS } = await import("@/services/queue");
    const { prisma } = await import("@/server/db");
    const owner = await seedOrganization("fence");
    const gateDir = mkdtempSync(join(tmpdir(), "fluxora-job-"));
    const gate = join(gateDir, "go");
    const due = await seedJob(owner, "RECEIVED", { createdAt: new Date(Date.now() - STALE_RECEIVED_MS - 1_000) });
    const holder = runProcess("tests/fixtures/job-recover-process.ts", { JOB_TEST_MODE: "hold", JOB_HOLD_GATE: gate });
    try {
      const started = Date.now();
      let claimed: { startedAt: Date | null } | null = null;
      while (Date.now() - started < 8_000) {
        const row = await prisma.job.findUnique({ where: { id: due.id } });
        if (row?.status === "PROCESSING" && row.startedAt) {
          claimed = row;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      expect(claimed?.startedAt).toBeTruthy();
      await prisma.job.update({
        where: { id: due.id },
        data: { startedAt: new Date(Date.now() - STALE_PROCESSING_MS - 1_000) },
      });
      const other = await runProcess("tests/fixtures/job-recover-process.ts", { JOB_TEST_MODE: "ok" });
      expect(other.code).toBe(0);
      writeFileSync(gate, "go");
      const held = await holder;
      expect(held.code).toBe(0);
      const job = await prisma.job.findUnique({ where: { id: due.id } });
      expect(job?.status).toBe("COMPLETED");
      expect(job?.attempts).toBe(2);
      expect(held.stdout + other.stdout + held.stderr + other.stderr).not.toMatch(/postgres(?:ql)?:\/\//i);
    } finally {
      writeFileSync(gate, "go");
      await holder;
      rmSync(gateDir, { recursive: true, force: true });
    }
  }, 40_000);

  it("completes a restarted job once when the command is repeated", async () => {
    const { STALE_RECEIVED_MS } = await import("@/services/queue");
    const { prisma } = await import("@/server/db");
    const owner = await seedOrganization("restart");
    const due = await seedJob(owner, "RECEIVED", { createdAt: new Date(Date.now() - STALE_RECEIVED_MS - 1_000) });
    const first = await runProcess("scripts/jobs-recover.ts", { JOB_TEST_MODE: "ok" });
    const second = await runProcess("scripts/jobs-recover.ts", { JOB_TEST_MODE: "ok" });
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const job = await prisma.job.findUnique({ where: { id: due.id } });
    expect(job?.status).toBe("COMPLETED");
    expect(job?.attempts).toBe(1);
    const report = JSON.parse(first.stdout) as { received: number; processing: number; stale: number; retrying: number; failed: number };
    expect(report).toEqual(expect.objectContaining({
      received: expect.any(Number),
      processing: expect.any(Number),
      stale: expect.any(Number),
      retrying: expect.any(Number),
      failed: expect.any(Number),
    }));
    expect(first.stdout + second.stdout).not.toMatch(/postgres(?:ql)?:\/\//i);
    const unreachable = await runProcess("scripts/jobs-recover.ts", { DATABASE_URL: "postgresql://127.0.0.1:1/fluxora_job_test" });
    expect(unreachable.code).toBe(1);
    expect(unreachable.stdout + unreachable.stderr).not.toMatch(/postgres(?:ql)?:\/\//i);
  }, 40_000);
});

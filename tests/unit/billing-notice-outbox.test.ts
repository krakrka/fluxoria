import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_NAME = "fluxora_notice_test";
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
    throw new Error(`PostgreSQL local indisponible. Les tests d'outbox ne sont pas validés. ${redact(message)}`);
  }
  if (listed === "1") return;
  execFileSync("docker", ["exec", "fluxora-postgres", "createdb", "-U", "fluxora", DATABASE_NAME], { stdio: "pipe" });
}

function migrateIsolatedDatabase(url: string) {
  try {
    execFileSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`Migration de la base isolée impossible. ${redact(stderr)}`);
  }
}

describe("billing notice outbox", () => {
  const suffix = `outbox-${Date.now()}`;
  const organizationIds: string[] = [];

  beforeAll(() => {
    ensureIsolatedDatabase();
    const url = databaseUrl();
    process.env.DATABASE_URL = url;
    migrateIsolatedDatabase(url);
    const globalForPrisma = globalThis as { prisma?: { $disconnect: () => Promise<void> } };
    delete globalForPrisma.prisma;
  }, 120_000);

  afterAll(async () => {
    const { prisma } = await import("@/server/db");
    const { setBillingNoticeForTests } = await import("@/services/stripe-billing");
    setBillingNoticeForTests(null);
    if (organizationIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await prisma.$disconnect();
    const globalForPrisma = globalThis as { prisma?: unknown };
    delete globalForPrisma.prisma;
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  async function seedNotice(status: "PENDING" | "PROCESSING", timing: { nextAttemptAt: Date; leaseUntil?: Date | null }) {
    const { prisma } = await import("@/server/db");
    const organization = await prisma.organization.create({ data: { name: `Outbox ${suffix} ${organizationIds.length}`, plan: "STARTER" } });
    organizationIds.push(organization.id);
    const event = await prisma.billingEvent.create({
      data: { stripeEventId: `evt_${organization.id}`, type: "checkout.session.completed", organizationId: organization.id, appliedAt: new Date() },
    });
    const notice = await prisma.billingNotice.create({
      data: {
        billingEventId: event.id,
        organizationId: organization.id,
        status,
        attempts: status === "PROCESSING" ? 1 : 0,
        nextAttemptAt: timing.nextAttemptAt,
        leaseUntil: timing.leaseUntil ?? null,
      },
    });
    return { organizationId: organization.id, billingEventId: event.id, noticeId: notice.id };
  }

  async function parkOpenNotices() {
    const { prisma } = await import("@/server/db");
    if (organizationIds.length === 0) return;
    await prisma.billingNotice.updateMany({
      where: { organizationId: { in: organizationIds }, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "FAILED", lastError: "parked" },
    });
  }

  it("reclaims an expired processing notice without a webhook", async () => {
    const { deliverDueBillingNotices, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    const { prisma } = await import("@/server/db");
    let calls = 0;
    setBillingNoticeForTests(async () => {
      calls += 1;
      return "sent";
    });
    const now = new Date("2026-10-18T02:00:00.000Z");
    await seedNotice("PROCESSING", { nextAttemptAt: now, leaseUntil: new Date(now.getTime() - 1_000) });
    await deliverDueBillingNotices(now);
    expect(calls).toBe(1);
    expect(await prisma.billingNotice.count({ where: { organization: { name: { startsWith: `Outbox ${suffix}` } }, status: "SENT" } })).toBe(1);
  });

  it("sends a due pending notice and waits for nextAttemptAt", async () => {
    await parkOpenNotices();
    const { deliverDueBillingNotices, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    const { prisma } = await import("@/server/db");
    let calls = 0;
    setBillingNoticeForTests(async () => {
      calls += 1;
      return "sent";
    });
    const now = new Date("2026-10-18T03:00:00.000Z");
    const waiting = await seedNotice("PENDING", { nextAttemptAt: new Date(now.getTime() + 60_000) });
    await deliverDueBillingNotices(now);
    expect(calls).toBe(0);
    expect((await prisma.billingNotice.findUnique({ where: { id: waiting.noticeId } }))?.status).toBe("PENDING");
    const due = await seedNotice("PENDING", { nextAttemptAt: now });
    await deliverDueBillingNotices(now);
    expect(calls).toBe(1);
    expect((await prisma.billingNotice.findUnique({ where: { id: due.noticeId } }))?.status).toBe("SENT");
  });

  it("stops after eight attempts", async () => {
    await parkOpenNotices();
    const { deliverBillingNotice, NOTICE_MAX_ATTEMPTS, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    const { prisma } = await import("@/server/db");
    setBillingNoticeForTests(async () => "failed");
    const seeded = await seedNotice("PENDING", { nextAttemptAt: new Date("2026-10-18T04:00:00.000Z") });
    let cursor = new Date("2026-10-18T04:00:00.000Z");
    for (let attempt = 0; attempt < NOTICE_MAX_ATTEMPTS; attempt += 1) {
      const current = await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } });
      if (current?.status === "FAILED") break;
      cursor = new Date((current?.nextAttemptAt.getTime() ?? cursor.getTime()) + 1);
      try {
        await deliverBillingNotice(seeded.billingEventId, cursor);
      } catch {
        // Tentative refusée.
      }
    }
    const failed = await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } });
    expect(failed?.status).toBe("FAILED");
    expect(failed?.attempts).toBe(NOTICE_MAX_ATTEMPTS);
    expect(await deliverBillingNotice(seeded.billingEventId, new Date(cursor.getTime() + 86_400_000))).toBe("failed");
  });

  it("lets only one of two calls in the same process send", async () => {
    await parkOpenNotices();
    const { deliverDueBillingNotices, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    let calls = 0;
    setBillingNoticeForTests(async () => {
      calls += 1;
      return "sent";
    });
    const now = new Date("2026-10-18T05:00:00.000Z");
    await seedNotice("PENDING", { nextAttemptAt: now });
    await Promise.all([deliverDueBillingNotices(now), deliverDueBillingNotices(now)]);
    expect(calls).toBe(1);
  });

  it("waits out a live lease after a crash, then sends once", async () => {
    await parkOpenNotices();
    const { deliverDueBillingNotices, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    const { prisma } = await import("@/server/db");
    let calls = 0;
    setBillingNoticeForTests(async () => {
      calls += 1;
      return "sent";
    });
    const claimedAt = new Date("2026-10-18T06:00:00.000Z");
    const seeded = await seedNotice("PROCESSING", {
      nextAttemptAt: claimedAt,
      leaseUntil: new Date(claimedAt.getTime() + 60_000),
    });
    await deliverDueBillingNotices(claimedAt);
    expect(calls).toBe(0);
    expect((await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } }))?.status).toBe("PROCESSING");
    await deliverDueBillingNotices(new Date(claimedAt.getTime() + 61_000));
    expect(calls).toBe(1);
    expect((await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } }))?.status).toBe("SENT");
  });

  it("does not call a missing mail provider a success", async () => {
    await parkOpenNotices();
    const { deliverDueBillingNotices, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    const { prisma } = await import("@/server/db");
    setBillingNoticeForTests(null);
    const now = new Date("2026-10-18T07:00:00.000Z");
    const seeded = await seedNotice("PENDING", { nextAttemptAt: now });
    await deliverDueBillingNotices(now);
    const notice = await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } });
    expect(notice?.status).toBe("PENDING");
    expect(notice?.sentAt).toBeNull();
    expect(notice?.lastError).toBe("email_not_configured");
  });

  it("refuses an old lease token when another worker owns the row", async () => {
    await parkOpenNotices();
    const { deliverDueBillingNotices, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    const { prisma } = await import("@/server/db");
    const now = new Date("2026-10-18T08:00:00.000Z");
    const seeded = await seedNotice("PENDING", { nextAttemptAt: now });
    setBillingNoticeForTests(async () => {
      await prisma.billingNotice.update({
        where: { id: seeded.noticeId },
        data: { leaseToken: "replaced-token", leaseUntil: new Date(now.getTime() + 120_000), status: "PROCESSING" },
      });
      return "sent";
    });
    await deliverDueBillingNotices(now);
    const notice = await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } });
    expect(notice?.status).toBe("PROCESSING");
    expect(notice?.leaseToken).toBe("replaced-token");
    expect(notice?.sentAt).toBeNull();
  });

  function runProcess(script: string, database: string, extra: Record<string, string> = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database, ...extra };
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

  it("gives one claim to two independent processes", async () => {
    await parkOpenNotices();
    const { prisma } = await import("@/server/db");
    const now = new Date();
    const seeded = await seedNotice("PENDING", { nextAttemptAt: now });
    const [first, second] = await Promise.all([
      runProcess("tests/fixtures/billing-notice-process.ts", databaseUrl(), { BILLING_NOTICE_TEST_MODE: "sent" }),
      runProcess("tests/fixtures/billing-notice-process.ts", databaseUrl(), { BILLING_NOTICE_TEST_MODE: "sent" }),
    ]);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.stdout + second.stdout + first.stderr + second.stderr).not.toMatch(/postgres(?:ql)?:\/\//i);
    const notice = await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } });
    expect(notice?.status).toBe("SENT");
    expect(notice?.attempts).toBe(1);
    expect(notice?.sentAt).not.toBeNull();
  }, 40_000);

  it("stops an expired process from finalizing a notice claimed by another process", async () => {
    await parkOpenNotices();
    const { prisma } = await import("@/server/db");
    const gateDir = mkdtempSync(join(tmpdir(), "fluxora-notice-"));
    const gate = join(gateDir, "go");
    const seeded = await seedNotice("PENDING", { nextAttemptAt: new Date() });
    const holder = runProcess("tests/fixtures/billing-notice-process.ts", databaseUrl(), {
      BILLING_NOTICE_TEST_MODE: "hold",
      BILLING_NOTICE_HOLD_GATE: gate,
    });
    try {
      const started = Date.now();
      let claimed: { leaseToken: string | null } | null = null;
      while (Date.now() - started < 8_000) {
        const row = await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } });
        if (row?.status === "PROCESSING" && row.leaseToken) {
          claimed = row;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      expect(claimed?.leaseToken).toBeTruthy();
      await prisma.billingNotice.update({
        where: { id: seeded.noticeId },
        data: { leaseUntil: new Date(Date.now() - 1_000) },
      });
      const other = await runProcess("tests/fixtures/billing-notice-process.ts", databaseUrl(), { BILLING_NOTICE_TEST_MODE: "sent" });
      expect(other.code).toBe(0);
      writeFileSync(gate, "go");
      const held = await holder;
      expect(held.code).toBe(0);
      const notice = await prisma.billingNotice.findUnique({ where: { id: seeded.noticeId } });
      expect(notice?.status).toBe("SENT");
      expect(notice?.attempts).toBe(2);
      expect(notice?.leaseToken).toBeNull();
      expect(held.stdout + other.stdout + held.stderr + other.stderr).not.toMatch(/postgres(?:ql)?:\/\//i);
    } finally {
      writeFileSync(gate, "go");
      await holder;
      rmSync(gateDir, { recursive: true, force: true });
    }
  }, 40_000);

  it("returns 0 for a finished sweep and 1 when the database cannot be reached", async () => {
    await parkOpenNotices();
    const first = await runProcess("scripts/billing-notices.ts", databaseUrl());
    const second = await runProcess("scripts/billing-notices.ts", databaseUrl());
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const report = JSON.parse(first.stdout) as {
      pending: number;
      processing: number;
      expired: number;
      failed: number;
      oldestPendingAgeSeconds: number | null;
      oldestFailedAgeSeconds: number | null;
    };
    expect(report).toEqual(expect.objectContaining({
      pending: expect.any(Number),
      processing: expect.any(Number),
      expired: expect.any(Number),
      failed: expect.any(Number),
    }));
    expect(first.stdout + second.stdout + first.stderr + second.stderr).not.toMatch(/postgres(?:ql)?:\/\//i);
    const unreachable = await runProcess("scripts/billing-notices.ts", "postgresql://127.0.0.1:1/fluxora_notice_test");
    expect(unreachable.code).toBe(1);
    expect(unreachable.stdout + unreachable.stderr).not.toMatch(/postgres(?:ql)?:\/\//i);
  }, 40_000);
});

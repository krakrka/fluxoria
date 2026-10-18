import { existsSync, readFileSync } from "node:fs";

function loadMissingEnv() {
  if (!existsSync(".env")) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function redact(text: string) {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted");
}

async function main() {
  loadMissingEnv();
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL est absent. Aucune notice n'est traitée.");
    process.exitCode = 1;
    return;
  }
  const { deliverDueBillingNotices } = await import("../services/stripe-billing");
  const { prisma } = await import("../server/db");
  try {
    const health = await deliverDueBillingNotices();
    console.log(JSON.stringify({
      pending: health.pending,
      processing: health.processing,
      expired: health.expired,
      failed: health.failed,
      oldestPendingAgeSeconds: health.oldestPendingAgeSeconds,
      oldestFailedAgeSeconds: health.oldestFailedAgeSeconds,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reprise des notices impossible.";
    console.error(redact(message).slice(0, 200));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

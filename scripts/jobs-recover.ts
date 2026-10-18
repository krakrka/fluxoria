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
    console.error("DATABASE_URL est absent. Aucun job n'est repris.");
    process.exitCode = 1;
    return;
  }
  const { jobHealth, promoteDueJobs } = await import("../services/queue");
  const { prisma } = await import("../server/db");
  try {
    await promoteDueJobs();
    const health = await jobHealth();
    console.log(JSON.stringify({
      received: health.received,
      processing: health.processing,
      stale: health.stale,
      retrying: health.retrying,
      failed: health.failed,
      oldestReceivedAgeSeconds: health.oldestReceivedAgeSeconds,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reprise des jobs impossible.";
    console.error(redact(message).slice(0, 200));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

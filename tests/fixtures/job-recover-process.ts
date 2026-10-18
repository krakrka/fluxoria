import { prisma } from "../../server/db";
import { jobHealth, promoteDueJobs } from "../../services/queue";

async function main() {
  try {
    await promoteDueJobs();
    const health = await jobHealth();
    process.stdout.write(JSON.stringify({
      received: health.received,
      processing: health.processing,
      stale: health.stale,
      retrying: health.retrying,
      failed: health.failed,
    }));
  } catch {
    process.stderr.write("sweep_failed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

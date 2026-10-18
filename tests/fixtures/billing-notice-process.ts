import { prisma } from "../../server/db";
import { deliverDueBillingNotices } from "../../services/stripe-billing";

async function main() {
  try {
    const health = await deliverDueBillingNotices();
    process.stdout.write(JSON.stringify({
      pending: health.pending,
      processing: health.processing,
      expired: health.expired,
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

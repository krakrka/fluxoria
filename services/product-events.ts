import "server-only";
import { prisma } from "@/server/db";

export const PRODUCT_EVENTS = [
  "signup",
  "onboarding_started",
  "onboarding_completed",
  "document_uploaded",
  "document_processed",
  "invoice_validated",
  "approval_created",
  "approval_completed",
  "automation_created",
  "subscription_started",
  "trial_converted",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

const ONCE = new Set<ProductEventName>(["signup", "onboarding_started", "onboarding_completed", "subscription_started", "trial_converted"]);

export async function recordProductEvent(input: { organizationId: string; userId?: string | null; name: ProductEventName }) {
  try {
    if (ONCE.has(input.name)) {
      const existing = await prisma.productEvent.findFirst({
        where: { organizationId: input.organizationId, name: input.name },
        select: { id: true },
      });
      if (existing) return;
    }
    await prisma.productEvent.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        name: input.name,
      },
    });
  } catch {
    // La mesure ne doit pas interrompre le traitement.
  }
}

export async function productEventCounts(organizationId: string) {
  const rows = await prisma.productEvent.groupBy({
    by: ["name"],
    where: { organizationId },
    _count: { _all: true },
  });
  return PRODUCT_EVENTS.map((name) => ({
    name,
    count: rows.find((row) => row.name === name)?._count._all ?? 0,
  }));
}

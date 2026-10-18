import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

function loadEnv() {
  if (process.env.DATABASE_URL && process.env.AUTH_SECRET) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

loadEnv();

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;

describe("business tenant isolation", () => {
  const ids: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("hides invoices, suppliers, orders and anomalies from the other organization", async () => {
    if (!prisma) return;
    const { setAnomalyStatus } = await import("@/services/anomalies");
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: `A ${suffix}` } });
    const orgB = await prisma.organization.create({ data: { name: `B ${suffix}` } });
    ids.push(orgA.id, orgB.id);
    const user = await prisma.user.create({
      data: { name: "B", email: `b.${suffix}@fluxora.test`, passwordHash: "x", activeOrganizationId: orgB.id },
    });
    const supplier = await prisma.supplier.create({ data: { organizationId: orgA.id, name: "Secret" } });
    const order = await prisma.purchaseOrder.create({
      data: { organizationId: orgA.id, supplierId: supplier.id, number: "BC-SECRET", amountHt: "10.00", amountTtc: "12.00" },
    });
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: orgA.id,
        supplierId: supplier.id,
        direction: "SUPPLIER",
        number: "FAC-SECRET",
        amountHt: "10.00",
        amountVat: "2.00",
        amountTtc: "12.00",
        matchedPurchaseOrderId: order.id,
      },
    });
    const anomaly = await prisma.anomaly.create({
      data: {
        organizationId: orgA.id,
        invoiceId: invoice.id,
        supplierId: supplier.id,
        purchaseOrderId: order.id,
        type: "AMOUNT_MISMATCH",
        severity: "CRITICAL",
        title: "Écart secret",
        description: "Ne doit pas fuir.",
        fingerprint: `AMOUNT_MISMATCH:${suffix}`,
      },
    });

    expect(await prisma.invoice.findFirst({ where: { id: invoice.id, organizationId: orgB.id } })).toBeNull();
    expect(await prisma.supplier.findFirst({ where: { id: supplier.id, organizationId: orgB.id } })).toBeNull();
    expect(await prisma.purchaseOrder.findFirst({ where: { id: order.id, organizationId: orgB.id } })).toBeNull();
    expect(await prisma.anomaly.findFirst({ where: { id: anomaly.id, organizationId: orgB.id } })).toBeNull();
    await expect(setAnomalyStatus({
      organizationId: orgB.id,
      userId: user.id,
      anomalyId: anomaly.id,
      status: "RESOLVED",
    })).rejects.toThrow(/introuvable/);
    const stillOpen = await prisma.anomaly.findFirst({ where: { id: anomaly.id, organizationId: orgA.id } });
    expect(stillOpen?.status).toBe("OPEN");
  });
});

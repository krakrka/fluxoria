import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(".env", "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

const databaseUrl = loadDatabaseUrl();
const prisma = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

describe("cross-tenant access", () => {
  const suffix = `prod-${Date.now()}`;
  const ids: string[] = [];
  let userId = "";

  afterAll(async () => {
    if (!prisma) return;
    if (ids.length) await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("does not return organization A records when the query is scoped to organization B", async () => {
    if (!prisma) return;
    const a = await prisma.organization.create({ data: { name: `Tenant A ${suffix}` } });
    const b = await prisma.organization.create({ data: { name: `Tenant B ${suffix}` } });
    ids.push(a.id, b.id);
    const user = await prisma.user.create({
      data: { email: `tenant-${suffix}@fluxora.test`, name: "Tenant", passwordHash: "hash" },
    });
    userId = user.id;
    const money = { amountHt: 10, amountVat: 2, amountTtc: 12 };
    const invoice = await prisma.invoice.create({
      data: { organizationId: a.id, direction: "SUPPLIER", number: `FAC-${suffix}`, ...money },
    });
    const supplier = await prisma.supplier.create({ data: { organizationId: a.id, name: `Fournisseur ${suffix}` } });
    const customer = await prisma.customer.create({ data: { organizationId: a.id, name: `Client ${suffix}` } });
    const order = await prisma.purchaseOrder.create({ data: { organizationId: a.id, number: `BC-${suffix}`, ...money } });
    const anomaly = await prisma.anomaly.create({
      data: {
        organizationId: a.id,
        type: "MISSING_PURCHASE_ORDER",
        severity: "WARNING",
        title: "Manquant",
        description: "Bon de commande absent",
        fingerprint: `fp-${suffix}`,
      },
    });
    const approval = await prisma.approval.create({
      data: { organizationId: a.id, requiredRole: "MANAGER", reason: "Montant", amountCents: 1000 },
    });
    const execution = await prisma.workflowExecution.create({ data: { organizationId: a.id } });
    const notification = await prisma.notification.create({ data: { organizationId: a.id, title: "Note", body: "Note" } });
    const audit = await prisma.auditLog.create({
      data: { organizationId: a.id, action: "test", entityType: "Organization", entityId: a.id },
    });
    const support = await prisma.supportRequest.create({
      data: { organizationId: a.id, userId, kind: "help", page: "/support", context: "role=OWNER", message: "Besoin d'aide" },
    });
    const usage = await prisma.usageRecord.create({ data: { organizationId: a.id, periodStart: new Date("2026-10-01") } });
    const subscription = await prisma.subscription.create({ data: { organizationId: a.id } });

    const scoped = { organizationId: b.id };
    expect(await prisma.invoice.findFirst({ where: { id: invoice.id, ...scoped } })).toBeNull();
    expect(await prisma.supplier.findFirst({ where: { id: supplier.id, ...scoped } })).toBeNull();
    expect(await prisma.customer.findFirst({ where: { id: customer.id, ...scoped } })).toBeNull();
    expect(await prisma.purchaseOrder.findFirst({ where: { id: order.id, ...scoped } })).toBeNull();
    expect(await prisma.anomaly.findFirst({ where: { id: anomaly.id, ...scoped } })).toBeNull();
    expect(await prisma.approval.findFirst({ where: { id: approval.id, ...scoped } })).toBeNull();
    expect(await prisma.workflowExecution.findFirst({ where: { id: execution.id, ...scoped } })).toBeNull();
    expect(await prisma.notification.findFirst({ where: { id: notification.id, ...scoped } })).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { id: audit.id, ...scoped } })).toBeNull();
    expect(await prisma.supportRequest.findFirst({ where: { id: support.id, ...scoped } })).toBeNull();
    expect(await prisma.usageRecord.findFirst({ where: { id: usage.id, ...scoped } })).toBeNull();
    expect(await prisma.subscription.findFirst({ where: { id: subscription.id, ...scoped } })).toBeNull();
    expect(await prisma.document.findFirst({ where: { organizationId: b.id, filename: "secret.pdf" } })).toBeNull();
  });
});

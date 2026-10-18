import "server-only";
import type { AccountingConnector } from "@/connectors/accounting/types";
import { isDemoOrganization } from "@/lib/roi";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { writeAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { exportValidatedInvoice, importExternalInvoice } from "@/services/invoices";
import { companyKey, matchParty } from "@/lib/party-match";

export async function saveConnectorToken(input: { organizationId: string; userId: string; provider: "PENNYLANE" | "GMAIL" | "GOOGLE_DRIVE"; token: string; scopes: string }) {
  const encryptedTokens = encryptSecret(input.token);
  const account = await prisma.connectorAccount.upsert({
    where: { organizationId_provider: { organizationId: input.organizationId, provider: input.provider } },
    create: {
      organizationId: input.organizationId,
      provider: input.provider,
      status: "CONNECTED",
      encryptedTokens,
      scopes: input.scopes,
    },
    update: { encryptedTokens, status: "CONNECTED", scopes: input.scopes, lastError: null },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "connector.connected",
    entityType: "ConnectorAccount",
    entityId: account.id,
    newValue: { provider: input.provider },
  });
  return account;
}

export async function enablePennylaneFixture(organizationId: string, userId: string) {
  const organization = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
  if (!isDemoOrganization(organization?.settings)) throw new Error("Le jeu de démonstration est réservé au mode démo.");
  return prisma.connectorAccount.upsert({
    where: { organizationId_provider: { organizationId, provider: "PENNYLANE" } },
    create: { organizationId, provider: "PENNYLANE", status: "CONNECTED", settings: { transport: "fixture" }, scopes: "pennylane:read pennylane:export" },
    update: { status: "CONNECTED", settings: { transport: "fixture" }, lastError: null },
  }).then(async (account) => {
    await writeAudit({ organizationId, userId, action: "connector.connected", entityType: "ConnectorAccount", entityId: account.id, newValue: { provider: "PENNYLANE", transport: "fixture" } });
    return account;
  });
}

export async function syncAccounting(input: { organizationId: string; userId: string; connector: AccountingConnector; token?: string }) {
  const account = await prisma.connectorAccount.findFirst({ where: { organizationId: input.organizationId, provider: input.connector.id } });
  const settings = (account?.settings ?? {}) as { transport?: string };
  const token = input.token ?? (account?.encryptedTokens ? decryptSecret(account.encryptedTokens) : settings.transport === "fixture" ? "fixture" : "");
  if (!token) throw new Error("Connecteur sans jeton.");
  try {
    const suppliers = await input.connector.listSuppliers(token);
    let supplierCount = 0;
    const existing = await prisma.supplier.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true, siren: true, vatNumber: true },
    });
    for (const supplier of suppliers) {
      if (matchParty(existing, supplier)) continue;
      const created = await prisma.supplier.create({
        data: {
          organizationId: input.organizationId,
          name: supplier.name,
          siren: supplier.siren,
          vatNumber: supplier.vatNumber,
          normalizedName: companyKey(supplier.name),
        },
      });
      existing.push(created);
      supplierCount += 1;
    }
    const invoices = await input.connector.listInvoices(token);
    let invoiceCount = 0;
    for (const invoice of invoices) {
      const imported = await importExternalInvoice({
        organizationId: input.organizationId,
        userId: input.userId,
        provider: input.connector.id,
        externalId: invoice.externalId,
        number: invoice.number,
        supplierName: invoice.supplierName,
        supplierSiren: invoice.supplierSiren,
        amountTtc: invoice.amountTtc,
        currency: invoice.currency,
        issuedAt: invoice.issuedAt ? new Date(invoice.issuedAt) : null,
      });
      if (imported.created) invoiceCount += 1;
    }
    if (account) {
      await prisma.connectorAccount.update({
        where: { id: account.id },
        data: { lastSyncAt: new Date(), lastError: null, status: "CONNECTED" },
      });
    }
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "connector.synced",
      entityType: "ConnectorAccount",
      entityId: account?.id ?? input.connector.id,
      newValue: { provider: input.connector.id, supplierCount, invoiceCount },
    });
    return { supplierCount, invoiceCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Synchronisation impossible.";
    if (account) await prisma.connectorAccount.update({ where: { id: account.id }, data: { status: "ERROR", lastError: message } });
    throw error;
  }
}

export async function exportInvoiceThroughConnector(input: {
  organizationId: string;
  userId: string;
  invoiceId: string;
  connector: AccountingConnector;
}) {
  const account = await prisma.connectorAccount.findFirst({ where: { organizationId: input.organizationId, provider: input.connector.id } });
  if (!account?.encryptedTokens) throw new Error("Connecteur sans jeton.");
  return exportValidatedInvoice({
    organizationId: input.organizationId,
    userId: input.userId,
    invoiceId: input.invoiceId,
    connector: input.connector,
    token: decryptSecret(account.encryptedTokens),
  });
}

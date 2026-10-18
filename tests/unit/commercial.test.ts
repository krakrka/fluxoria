import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { DEMO_PATH } from "@/lib/demo-story";
import { planCatalog } from "@/lib/plans";
import { productionReadiness } from "@/lib/readiness";
import { registerOrganization } from "@/services/organization";
import { recordProductEvent } from "@/services/product-events";
import { createSupportRequest } from "@/services/support";

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
const suffix = `go-${Date.now()}`;

describe("commercial readiness", () => {
  const organizationIds: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    await prisma.$disconnect();
  });

  it("keeps prices in the catalog and describes the demo path", () => {
    const plans = planCatalog();
    expect(plans.STARTER.price).toBe("99 € / mois");
    expect(plans.PRO.price).toBe("299 € / mois");
    expect(plans.BUSINESS.price).toBe("Sur devis");
    expect(plans.STARTER.benefits.length).toBeGreaterThan(0);
    expect(DEMO_PATH.map((step) => step.title)).toEqual([
      "PDF facture",
      "Extraction",
      "Fournisseur",
      "Bon de commande",
      "Rapprochement",
      "Anomalie",
      "Règle",
      "Validation ou approbation",
      "Audit",
    ]);
  });

  it("does not print secrets in the production checklist", () => {
    process.env.AUTH_SECRET = "super-secret-value";
    const report = JSON.stringify(productionReadiness());
    expect(report).not.toContain("super-secret-value");
    expect(report).toContain("Stripe");
    expect(report).toContain("Sauvegardes");
  });

  it("records signup once and refuses a support note that is too short", async () => {
    if (!prisma) return;
    const organization = await registerOrganization({
      name: "Camille Go",
      email: `owner.${suffix}@fluxora.test`,
      password: "Fluxora-Demo-2026",
      organizationName: `Go ${suffix}`,
    });
    organizationIds.push(organization.id);
    const userId = organization.members[0]?.userId ?? "";
    await recordProductEvent({ organizationId: organization.id, userId, name: "signup" });
    const signups = await prisma.productEvent.count({ where: { organizationId: organization.id, name: "signup" } });
    expect(signups).toBe(1);
    await expect(createSupportRequest({
      organizationId: organization.id,
      userId,
      role: "OWNER",
      plan: "STARTER",
      kind: "help",
      page: "/invoices",
      message: "court",
    })).rejects.toThrow(/phrases/);
    const saved = await createSupportRequest({
      organizationId: organization.id,
      userId,
      role: "OWNER",
      plan: "STARTER",
      kind: "bug",
      page: "/documents",
      message: "Le dépôt d'un PDF reste sur l'écran sans message.",
    });
    expect(saved.context).toBe("role=OWNER; plan=STARTER");
    expect(saved.message).not.toContain("password");
  });
});

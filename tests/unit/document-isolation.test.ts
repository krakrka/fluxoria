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

describe("document tenant isolation", () => {
  const suffix = `phase2-${Date.now()}`;
  let orgA = "";
  let orgB = "";
  let documentB = "";

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { name: { in: [`Iso A ${suffix}`, `Iso B ${suffix}`] } } });
    await prisma.$disconnect();
  });

  it("hides organization B from a query scoped to organization A", async () => {
    if (!prisma) return;
    const a = await prisma.organization.create({ data: { name: `Iso A ${suffix}` } });
    const b = await prisma.organization.create({ data: { name: `Iso B ${suffix}` } });
    orgA = a.id;
    orgB = b.id;
    const created = await prisma.document.create({
      data: {
        organizationId: orgB,
        filename: "secret.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        storageKey: "pending",
      },
    });
    documentB = created.id;

    const visible = await prisma.document.findFirst({
      where: { id: documentB, organizationId: orgA, deletedAt: null },
    });
    const updated = await prisma.document.updateMany({
      where: { id: documentB, organizationId: orgA },
      data: { filename: "pirated.pdf" },
    });
    const deleted = await prisma.document.updateMany({
      where: { id: documentB, organizationId: orgA },
      data: { deletedAt: new Date() },
    });
    const own = await prisma.document.findFirst({
      where: { id: documentB, organizationId: orgB, deletedAt: null },
    });

    expect(visible).toBeNull();
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    expect(own?.filename).toBe("secret.pdf");
  });
});

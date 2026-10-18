import { e2ePrisma } from "./db";
import { expect, test } from "./fixtures";
import { registerOwner } from "./session";

test("inscription, dépôt, traitement et validation", async ({ page }) => {
  test.setTimeout(180_000);
  await registerOwner(page, String(Date.now()), "depot");

  await page.goto("/documents");
  await page.getByLabel("Fichiers à importer").setInputFiles({
    name: "facture-fournisseur.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await page.getByRole("link", { name: "Ouvrir" }).click();
  await expect(page.getByText("Niveau de confiance estimé par Fluxora.").first()).toBeVisible({ timeout: 30_000 });
  const modifier = page.getByRole("button", { name: "Modifier Numéro", exact: true });
  const numero = page.getByRole("textbox", { name: "Numéro", exact: true });
  await expect(modifier).toBeVisible();
  await expect(async () => {
    if (await numero.isVisible()) return;
    await modifier.click();
    await expect(numero).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await numero.fill("FAC-E2E-900");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Champ corrigé. La valeur reste marquée comme saisie manuellement.")).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("FAC-E2E-900")).toBeVisible();
  await expect(page.getByText("Champ modifié")).toBeVisible();
  await page.getByRole("button", { name: "Valider le document" }).click();
  await expect(page.getByText("Validé", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.goto("/dashboard");
  await expect(page.getByText("Documents validés")).toBeVisible();
});

test("une organisation ne lit pas le document d'une autre", async ({ browser }) => {
  test.setTimeout(180_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const stamp = Date.now();

  await registerOwner(pageA, String(stamp), "alice");
  await pageA.goto("/documents");
  await pageA.getByLabel("Fichiers à importer").setInputFiles({
    name: "facture-fournisseur.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await pageA.getByRole("button", { name: "Importer", exact: true }).click();
  const openedLink = pageA.getByRole("link", { name: "Ouvrir" });
  await expect(openedLink).toBeVisible({ timeout: 40_000 });
  const opened = await openedLink.getAttribute("href");
  const documentId = opened?.split("/").pop();
  expect(documentId).toBeTruthy();

  const orgB = await registerOwner(pageB, `${stamp}b`, "bruno");

  await expect(pageB.getByText(orgB.organization)).toBeVisible();
  await pageB.goto(`/documents/${documentId}`);
  await expect(pageB.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  await expect(pageB.getByText("facture-fournisseur.pdf")).toHaveCount(0);
  const download = await pageB.request.get(`/api/documents/${documentId}/file`);
  const read = await pageB.request.get(`/api/documents/${documentId}`);
  const validate = await pageB.request.post(`/api/documents/${documentId}/validate`);
  const reject = await pageB.request.post(`/api/documents/${documentId}/reject`, {
    data: { code: "wrong_document" },
  });
  const reprocess = await pageB.request.post(`/api/documents/${documentId}/process`);
  expect(download.status()).toBe(404);
  expect(read.status()).toBe(404);
  expect(validate.status()).toBe(404);
  expect(reject.status()).toBe(404);
  expect(reprocess.status()).toBe(404);

  const ownDownload = await pageA.request.get(`/api/documents/${documentId}/file`);
  expect(ownDownload.status()).toBe(200);
  const prisma = e2ePrisma();
  const stored = await prisma.document.findFirst({
    where: { id: documentId },
    select: { storageKey: true, organizationId: true },
  });
  expect(stored?.storageKey.startsWith(`organizations/${stored.organizationId}/`)).toBe(true);
  const foreignKey = `organizations/autre-organisation/documents/${documentId}/original`;
  await prisma.document.update({ where: { id: documentId }, data: { storageKey: foreignKey } });
  try {
    const blocked = await pageA.request.get(`/api/documents/${documentId}/file`);
    expect(blocked.status()).toBe(404);
  } finally {
    if (stored) await prisma.document.update({ where: { id: documentId }, data: { storageKey: stored.storageKey } });
    await prisma.$disconnect();
  }

  await contextA.close();
  await contextB.close();
});

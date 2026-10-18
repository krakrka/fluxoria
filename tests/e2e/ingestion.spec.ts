import { expect, test } from "./fixtures";
import { login, registerOwner } from "./session";

test("boîte, aperçu CSV et système", async ({ page }) => {
  await registerOwner(page, String(Date.now()), "import");

  await page.goto("/inbox");
  await expect(page.getByText(/factures\+[a-z0-9]+@inbox\.fluxora\.test/)).toBeVisible();
  await page.getByLabel("Email source").fill("fournisseur@exemple.fr");
  await page.getByLabel("Pièces jointes").setInputFiles({
    name: "facture-fournisseur.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\n% ${Date.now()}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`),
  });
  await page.getByRole("button", { name: "Recevoir dans la boîte" }).click();
  await expect(page.getByText("1 document(s) mis en traitement.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("fournisseur@exemple.fr").first()).toBeVisible();

  await page.goto("/imports");
  await page.getByLabel("Contenu CSV").fill("nom,siren,tva\nMauvaise,123,FR00\n");
  await page.getByRole("button", { name: "Prévisualiser" }).click();
  await expect(page.locator("li").filter({ hasText: "SIREN invalide" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/sources");
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pennylane" })).toBeVisible();
  await expect(page.getByText("Non branché").first()).toBeVisible();

  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { name: "Système" })).toBeVisible();
  await expect(page.getByText("Jobs en échec")).toBeVisible();
});

test("le manager ne voit pas le suivi technique", async ({ page }) => {
  await login(page, "manager@atlas-industrie.test");
  await page.goto("/admin/system");
  await expect(page.getByText("Accès limité")).toBeVisible();
  await expect(page.getByRole("link", { name: "Système" })).toHaveCount(0);
  await page.goto("/sources");
  await expect(page.getByText("Les connecteurs sont réservés au propriétaire et à l'admin.")).toBeVisible();
});

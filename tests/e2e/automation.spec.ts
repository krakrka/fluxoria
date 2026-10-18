import { expect, test } from "./fixtures";
import { inviteManager, login, managerInvoicePdf, matchedInvoicePdf, openLinkedRecord, purchaseOrderPdf, registerOwner, uploadPdf } from "./session";

test("approbation manager puis facture validée", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = String(Date.now());
  const invoiceNumber = `FAC-E2E-MGR-${stamp}`;
  const managerEmail = `e2e.manager.${stamp}@fluxora.test`;
  await registerOwner(page, stamp, "approbation");
  await inviteManager(page, managerEmail);
  await uploadPdf(page, "facture-manager.pdf", managerInvoicePdf(invoiceNumber));

  await page.goto(`/invoices?q=${invoiceNumber}`);
  await expect(page.getByRole("link", { name: invoiceNumber })).toBeVisible({ timeout: 20_000 });

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await registerOwner(otherPage, `${stamp}b`, "isolee");
  await otherPage.goto(`/approvals`);
  await expect(otherPage.getByText(invoiceNumber)).toHaveCount(0);
  await otherPage.goto(`/invoices?q=${invoiceNumber}`);
  await expect(otherPage.getByRole("link", { name: invoiceNumber })).toHaveCount(0);
  await other.close();

  await page.getByRole("button", { name: "Déconnexion" }).click();
  await login(page, managerEmail);
  await page.goto("/approvals");
  await openLinkedRecord(page, invoiceNumber, /\/approvals\/[^/?#]+/);
  await expect(page.getByText("Pourquoi cette approbation est nécessaire")).toBeVisible();
  await expect(page.getByText("Niveau demandé : manager")).toBeVisible();
  const submitted = page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
  await page.getByRole("button", { name: "Approuver" }).click();
  const decision = await submitted;
  expect(decision.ok(), "L'approbation n'a pas abouti.").toBeTruthy();
  await expect(page.getByRole("button", { name: "Enregistrement…" })).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Approuver" })).toHaveCount(0);
  await page.goto(`/invoices?q=${invoiceNumber}`);
  await expect(page.getByRole("row").filter({ hasText: invoiceNumber }).getByText("Validée", { exact: true })).toBeVisible({ timeout: 60_000 });
  await openLinkedRecord(page, invoiceNumber, /\/invoices\/[^/?#]+/);
  await expect(page.getByText("Validée", { exact: true })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByText("Seuls le propriétaire et l'admin peuvent modifier ces seuils.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer les seuils" })).toHaveCount(0);
  await page.goto("/automations");
  await expect(page.getByRole("button", { name: "Créer la règle" })).toHaveCount(0);
  await expect(page.getByText("invoice.total < 1000 ET invoice.matchScore ≥ 95")).toBeVisible();
});

test("facture auto-validée et explication visibles", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = String(Date.now());
  const orderNumber = `BC-E2E-${stamp}`;
  const invoiceNumber = `FAC-E2E-AUTO-${stamp}`;
  await registerOwner(page, stamp, "autoval");
  await uploadPdf(page, "bon-commande.pdf", purchaseOrderPdf(orderNumber));
  await uploadPdf(page, "facture-auto.pdf", matchedInvoicePdf(invoiceNumber, orderNumber));
  await page.goto(`/invoices?q=${invoiceNumber}`);
  await expect(page.getByRole("row").filter({ hasText: invoiceNumber }).getByText("Validée", { exact: true })).toBeVisible({ timeout: 60_000 });
  await openLinkedRecord(page, invoiceNumber, /\/invoices\/[^/?#]+/);
  await expect(page.getByText("Validée automatiquement par Fluxora")).toBeVisible();
  await expect(page.getByText("Règle appliquée : « Factures inférieures à 1 000 € »")).toBeVisible();
});

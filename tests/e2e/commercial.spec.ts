import { expect, test } from "./fixtures";
import { login, registerOwner } from "./session";

test("la vitrine présente le positionnement, les tarifs et le parcours", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "L'automatisation administrative intelligente des PME." })).toBeVisible();
  await expect(page.getByText("Moins de saisie")).toBeVisible();
  await expect(page.getByRole("link", { name: "Commencer" }).first()).toBeVisible();
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Starter, Pro, Business" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Demander une démo" }).first()).toBeVisible();
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "De la facture PDF au journal, en quelques minutes." })).toBeVisible();
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Factures" })).toBeVisible();
  await page.goto("/legal/privacy");
  await expect(page.getByText("PLACEHOLDER JURIDIQUE")).toBeVisible();
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Non mesuré" })).toBeVisible();
});

test("le propriétaire voit les minutes gagnées et le parcours Atlas", async ({ page }) => {
  await login(page, "owner@atlas-industrie.test");
  await expect(page.getByText(/Fluxora vous a fait gagner \d+ minutes?\./)).toBeVisible({ timeout: 30_000 });
  await page.goto("/parcours");
  await expect(page.getByRole("heading", { name: "Parcours Atlas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir" }).first()).toBeVisible();
  await page.goto("/support");
  await expect(page.getByRole("heading", { name: "Contacter Fluxora" })).toBeVisible();
  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { name: "Mise en production" })).toBeVisible();
  await expect(page.getByText("Billing non configuré. Stripe n'est pas branché. L'application continue de fonctionner.")).toBeVisible();
});

test("un autre tenant ne voit pas la facture d'Atlas et le manager n'ouvre pas la facturation", async ({ page }) => {
  await registerOwner(page, String(Date.now()), "iso");
  await expect(page.getByText(/Fluxora vous a fait gagner 0 minute/)).toBeVisible();
  await page.goto("/search?q=FAC-AUTO-700");
  await expect(page.getByRole("link", { name: "FAC-AUTO-700" })).toHaveCount(0);
  await page.goto("/billing");
  await expect(page.getByText("Essai", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Choisir Starter" }).click();
  await expect(page.getByText("Billing non configuré").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Essai", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Déconnexion" }).click();
  await login(page, "manager@atlas-industrie.test");
  await expect(page.getByRole("link", { name: "Facturation" })).toHaveCount(0);
  await page.goto("/billing");
  await expect(page.getByText("Action non autorisée pour ce rôle.")).toBeVisible();
});

import { expect, test } from "./fixtures";
import { login, registerOwner } from "./session";

test("cockpit, recherche, ROI et mode démo", async ({ page }) => {
  await login(page, "owner@atlas-industrie.test");
  await expect(page.getByText("MODE DÉMO").first()).toBeVisible();
  await expect(page.getByText("À traiter aujourd'hui")).toBeVisible();
  await expect(page.getByText("Estimation opérationnelle").first()).toBeVisible();

  await page.goto("/attention");
  await expect(page.getByRole("heading", { name: "À traiter" })).toBeVisible();
  await page.goto("/roi");
  await expect(page.getByText("Ce n'est pas une économie comptable réelle.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer les hypothèses" })).toBeVisible();
  await page.goto("/search?q=FAC-AUTO-700");
  await expect(page.getByRole("link", { name: "FAC-AUTO-700" })).toBeVisible({ timeout: 20_000 });
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
});

test("le manager voit le ROI sans modifier les hypothèses", async ({ page }) => {
  await login(page, "manager@atlas-industrie.test");
  await page.goto("/roi");
  await expect(page.getByText("Seuls le propriétaire et l'admin peuvent les modifier.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer les hypothèses" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Membres" })).toHaveCount(0);
});

test("une nouvelle organisation voit la checklist d'onboarding", async ({ page }) => {
  await registerOwner(page, String(Date.now()), "onboard");
  await expect(page.getByText("MODE DÉMO")).toHaveCount(0);
  await expect(page.getByText("Premier document importé")).toBeVisible();
  await page.goto("/onboarding");
  await page.getByLabel("Secteur").fill("Conseil");
  await page.getByRole("button", { name: "Enregistrer et installer la règle de base" }).click();
  await expect(page.getByText("Organisation prête.")).toBeVisible({ timeout: 20_000 });
});

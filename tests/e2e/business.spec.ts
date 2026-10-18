import { expect, test } from "./fixtures";
import { correctInvoiceNumber, openLinkedRecord, registerOwner, unmatchedInvoicePdf, uploadPdf } from "./session";

test("facture sans commande, anomalie et résolution", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = String(Date.now());
  const extracted = `FAC-E2E-SANS-${stamp}`;
  const corrected = `FAC-E2E-CORR-${stamp}`;
  await registerOwner(page, stamp, "anomalie");
  await uploadPdf(page, "facture-sans-commande.pdf", unmatchedInvoicePdf(extracted));
  await correctInvoiceNumber(page, corrected);
  await page.reload();
  await expect(page.getByText(corrected)).toBeVisible();
  await expect(page.getByText("Champ modifié")).toBeVisible();

  await page.goto(`/invoices?q=${corrected}`);
  await openLinkedRecord(page, corrected, /\/invoices\/[^/?#]+/);
  await openLinkedRecord(page, "Facture sans bon de commande", /\/anomalies\/[^/?#]+/);
  await expect(page.getByText("Aucun bon de commande n'est associé")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Résoudre" }).click();
  await expect(page.getByText("Résolue")).toBeVisible({ timeout: 30_000 });
  await page.goto("/dashboard");
  await expect(page.getByText("Factures sans commande").first()).toBeVisible();
  await expect(page.getByText("Anomalies critiques").first()).toBeVisible();
  await expect(page.getByText("À traiter aujourd'hui")).toBeVisible();
});

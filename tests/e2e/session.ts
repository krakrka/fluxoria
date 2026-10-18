import { readFileSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { expect, type Page } from "@playwright/test";
import { findValidSirens, vatFromSiren } from "../../lib/siren";
import { buildSimplePdf } from "../../services/pdf";
import { e2ePrisma } from "./db";

export const E2E_PASSWORD = "Fluxora-Demo-2026";

const trackedEmails: string[] = [];

export function trackE2EAccount(email: string) {
  if (!email.startsWith("e2e.") || !email.endsWith("@fluxora.test")) return;
  trackedEmails.push(email);
}

function storageRoot() {
  const current = process.env.STORAGE_LOCAL_DIR?.trim();
  if (current) return current;
  try {
    const line = readFileSync(".env", "utf8").split(/\r?\n/).find((row) => row.startsWith("STORAGE_LOCAL_DIR="));
    const value = line?.slice("STORAGE_LOCAL_DIR=".length).trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  } catch {
    return "storage";
  }
  return "storage";
}

export async function removeTrackedE2EAccounts() {
  const emails = trackedEmails.splice(0, trackedEmails.length);
  if (emails.length === 0) return;
  const prisma = e2ePrisma();
  try {
    const memberships = await prisma.organizationMember.findMany({
      where: { user: { email: { in: emails } } },
      select: { organizationId: true, organization: { select: { name: true } } },
    });
    const orgIds = [...new Set(memberships.filter((membership) => membership.organization.name.startsWith("E2E ")).map((membership) => membership.organizationId))];
    if (orgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: orgIds }, name: { startsWith: "E2E " } } });
      const root = storageRoot();
      for (const id of orgIds) await rm(path.join(root, "organizations", id), { recursive: true, force: true });
    }
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  } finally {
    await prisma.$disconnect();
  }
}

async function expectDashboard(page: Page) {
  const heading = page.getByRole("heading", { name: "Tableau de bord" });
  const formAlert = page.locator("form").getByRole("alert");
  await expect(heading.or(formAlert)).toBeVisible({ timeout: 90_000 });
  if (await formAlert.isVisible()) throw new Error(`Formulaire refusé : ${await formAlert.innerText()}`);
}

const siren = findValidSirens(1)[0];
const vat = vatFromSiren(siren);
const matchedLine = "LIGNE Fourniture bureau | 2 | 50.00 | 20 | 100.00";

export async function registerOwner(page: Page, stamp: string, label: string) {
  const email = `e2e.${label}.${stamp}@fluxora.test`;
  const organization = `E2E ${label} ${stamp}`;
  await page.goto("/register");
  await page.getByLabel("Votre nom").fill(`Pilote ${label}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("textbox", { name: "Organisation", exact: true }).fill(organization);
  await page.getByRole("checkbox").check();
  trackE2EAccount(email);
  await page.getByRole("button", { name: "Créer l'organisation" }).click();
  await expectDashboard(page);
  return { email, organization };
}

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expectDashboard(page);
}

export async function inviteManager(page: Page, email: string) {
  await page.goto("/settings");
  const invite = page.locator("form").filter({ has: page.getByRole("button", { name: "Créer l'utilisateur" }) });
  await invite.getByLabel("Nom").fill("Maya Manager");
  await invite.getByLabel("Email").fill(email);
  await invite.getByLabel("Mot de passe temporaire").fill(E2E_PASSWORD);
  await invite.getByLabel("Rôle").selectOption("MANAGER");
  trackE2EAccount(email);
  await invite.getByRole("button", { name: "Créer l'utilisateur" }).click();
  const confirmation = page.getByText("Utilisateur ajouté à l'organisation.");
  const formAlert = invite.getByRole("alert");
  await expect(confirmation.or(formAlert)).toBeVisible({ timeout: 60_000 });
  if (await formAlert.isVisible()) throw new Error(`Invitation refusée : ${await formAlert.innerText()}`);
}

export async function openLinkedRecord(page: Page, name: string, url: RegExp) {
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await Promise.all([page.waitForURL(url, { timeout: 60_000 }), link.click()]);
}

export async function uploadPdf(page: Page, name: string, buffer: Buffer) {
  await page.goto("/documents");
  await page.getByLabel("Fichiers à importer").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer,
  });
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await expect(page.getByRole("link", { name: "Ouvrir" })).toBeVisible({ timeout: 40_000 });
  await page.getByRole("link", { name: "Ouvrir" }).click();
  await expect(page.getByText("Niveau de confiance estimé par Fluxora.").first()).toBeVisible({ timeout: 45_000 });
}

export async function correctInvoiceNumber(page: Page, number: string) {
  const modifier = page.getByRole("button", { name: "Modifier Numéro", exact: true });
  const numero = page.getByRole("textbox", { name: "Numéro", exact: true });
  await expect(modifier).toBeVisible();
  await expect(async () => {
    if (await numero.isVisible()) return;
    await modifier.click();
    await expect(numero).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await numero.fill(number);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Champ corrigé. La valeur reste marquée comme saisie manuellement.")).toBeVisible({ timeout: 20_000 });
}

export function purchaseOrderPdf(number: string) {
  return Buffer.from(
    buildSimplePdf([
      "BON DE COMMANDE",
      `Numero : ${number}`,
      "Date : 2026-10-01",
      "Fournisseur : Atelier Lumiere",
      `SIREN : ${siren}`,
      `TVA intra : ${vat}`,
      "Client : Pilote E2E",
      "Devise : EUR",
      matchedLine,
      "Total HT : 100.00",
      "TVA : 20.00",
      "Total TTC : 120.00",
    ]),
  );
}

export function matchedInvoicePdf(invoiceNumber: string, orderNumber: string) {
  return Buffer.from(
    buildSimplePdf([
      "FACTURE",
      `Facture no ${invoiceNumber}`,
      "Date : 2026-10-01",
      "Echeance : 2026-11-01",
      "Fournisseur : Atelier Lumiere",
      `SIREN : ${siren}`,
      `TVA intra : ${vat}`,
      "Client : Pilote E2E",
      "Devise : EUR",
      "Conditions : 30 jours",
      `Commande : ${orderNumber}`,
      matchedLine,
      "Total HT : 100.00",
      "TVA : 20.00",
      "Total TTC : 120.00",
    ]),
  );
}

export function managerInvoicePdf(invoiceNumber: string) {
  return Buffer.from(
    buildSimplePdf([
      "FACTURE",
      `Facture no ${invoiceNumber}`,
      "Date : 2026-10-01",
      "Echeance : 2026-11-01",
      "Fournisseur : Atelier Lumiere",
      `SIREN : ${siren}`,
      `TVA intra : ${vat}`,
      "Client : Pilote E2E",
      "Devise : EUR",
      "Conditions : 30 jours",
      "LIGNE Prestation | 1 | 2000.00 | 20 | 2000.00",
      "Total HT : 2000.00",
      "TVA : 400.00",
      "Total TTC : 2400.00",
    ]),
  );
}

export function unmatchedInvoicePdf(invoiceNumber: string) {
  return Buffer.from(
    buildSimplePdf([
      "FACTURE",
      `Facture no ${invoiceNumber}`,
      "Date : 2026-10-01",
      "Echeance : 2026-11-01",
      "Fournisseur : Atelier Lumiere",
      `SIREN : ${siren}`,
      `TVA intra : ${vat}`,
      "Client : Pilote E2E",
      "Devise : EUR",
      "Conditions : 30 jours",
      "LIGNE Prestation | 1 | 100.00 | 20 | 100.00",
      "Total HT : 100.00",
      "TVA : 20.00",
      "Total TTC : 120.00",
    ]),
  );
}

import "server-only";
import { Prisma } from "@prisma/client";
import { cell, parseCsv, type CsvRow } from "@/lib/csv";
import { parseAmountToCents } from "@/lib/money";
import { companyKey, matchParty } from "@/lib/party-match";
import { isValidFrenchVat, isValidSiren } from "@/lib/siren";
import { writeAudit } from "@/server/audit";
import { prisma } from "@/server/db";

export type CsvKind = "suppliers" | "customers" | "orders";

export type CsvPreviewRow = { line: number; summary: string; status: "ok" | "error"; message: string };

export function previewCsv(kind: CsvKind, text: string) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { rows: [] as CsvPreviewRow[], error: "Le fichier ne contient aucune ligne." };
  const seen = new Set<string>();
  const preview = rows.map((row, index) => {
    const parsed = describe(kind, row);
    const key = parsed.key;
    if (parsed.ok && key && seen.has(key)) return { line: index + 2, summary: parsed.summary, status: "error" as const, message: "Doublon dans le fichier." };
    if (parsed.ok && key) seen.add(key);
    return { line: index + 2, summary: parsed.summary, status: parsed.ok ? "ok" as const : "error" as const, message: parsed.message };
  });
  return { rows: preview, error: null };
}

export async function commitCsv(input: { organizationId: string; userId: string; kind: CsvKind; text: string }) {
  const preview = previewCsv(input.kind, input.text);
  if (preview.error) throw new Error(preview.error);
  const parsed = parseCsv(input.text);
  let imported = 0;
  let skipped = 0;
  if (input.kind === "suppliers" || input.kind === "customers") {
    const parties = input.kind === "suppliers"
      ? await prisma.supplier.findMany({ where: { organizationId: input.organizationId }, select: { id: true, name: true, siren: true, vatNumber: true } })
      : await prisma.customer.findMany({ where: { organizationId: input.organizationId }, select: { id: true, name: true, siren: true, vatNumber: true } });
    for (const [index, row] of parsed.entries()) {
      if (preview.rows[index]?.status !== "ok") {
        skipped += 1;
        continue;
      }
      const identity = partyFrom(row);
      if (matchParty(parties, identity)) {
        skipped += 1;
        continue;
      }
      if (input.kind === "suppliers") {
        const created = await prisma.supplier.create({
          data: { organizationId: input.organizationId, name: identity.name, siren: identity.siren, vatNumber: identity.vatNumber, email: identity.email, category: identity.category, normalizedName: companyKey(identity.name) },
        });
        parties.push(created);
      } else {
        const created = await prisma.customer.create({
          data: { organizationId: input.organizationId, name: identity.name, siren: identity.siren, vatNumber: identity.vatNumber, email: identity.email, normalizedName: companyKey(identity.name) },
        });
        parties.push(created);
      }
      imported += 1;
    }
  } else {
    const orders = await prisma.purchaseOrder.findMany({ where: { organizationId: input.organizationId }, select: { number: true } });
    const known = new Set(orders.map((order) => order.number.toLowerCase()));
    const suppliers = await prisma.supplier.findMany({ where: { organizationId: input.organizationId }, select: { id: true, name: true, siren: true, vatNumber: true } });
    for (const [index, row] of parsed.entries()) {
      if (preview.rows[index]?.status !== "ok") {
        skipped += 1;
        continue;
      }
      const number = cell(row, ["numero", "numéro", "number"]);
      if (known.has(number.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const supplier = matchParty(suppliers, { name: cell(row, ["fournisseur", "supplier"]), siren: cell(row, ["siren"]) || null, vatNumber: null });
      if (!supplier) {
        skipped += 1;
        continue;
      }
      const cents = parseAmountToCents(cell(row, ["montant_ttc", "montant", "amount"]));
      const amount = new Prisma.Decimal(((cents ?? 0) / 100).toFixed(2));
      const issued = cell(row, ["date", "issuedat"]);
      await prisma.purchaseOrder.create({
        data: {
          organizationId: input.organizationId,
          supplierId: supplier.id,
          number,
          issuedAt: issued ? new Date(`${issued}T00:00:00.000Z`) : null,
          amountHt: amount,
          amountVat: new Prisma.Decimal(0),
          amountTtc: amount,
          currency: (cell(row, ["devise", "currency"]) || "EUR").toUpperCase(),
          status: "OPEN",
        },
      });
      known.add(number.toLowerCase());
      imported += 1;
    }
  }
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "csv.imported",
    entityType: "Organization",
    entityId: input.organizationId,
    newValue: { kind: input.kind, imported, skipped },
  });
  return { imported, skipped };
}

function describe(kind: CsvKind, row: CsvRow) {
  if (kind === "orders") return describeOrder(row);
  return describeParty(row);
}

function describeParty(row: CsvRow) {
  const name = cell(row, ["nom", "name"]);
  const siren = cell(row, ["siren"]).replace(/\s/g, "");
  const vat = cell(row, ["tva", "vat", "vatnumber"]).replace(/\s/g, "").toUpperCase();
  if (!name) return { ok: false, summary: "Sans nom", message: "Le nom est obligatoire.", key: "" };
  if (siren && !isValidSiren(siren)) return { ok: false, summary: name, message: "SIREN invalide.", key: "" };
  if (vat && !isValidFrenchVat(vat)) return { ok: false, summary: name, message: "TVA invalide.", key: "" };
  if (siren && vat && !vat.endsWith(siren)) return { ok: false, summary: name, message: "La TVA ne correspond pas au SIREN.", key: "" };
  return { ok: true, summary: name, message: "Prêt à importer.", key: siren || name.toLowerCase() };
}

function describeOrder(row: CsvRow) {
  const number = cell(row, ["numero", "numéro", "number"]);
  const supplier = cell(row, ["fournisseur", "supplier"]);
  const amount = parseAmountToCents(cell(row, ["montant_ttc", "montant", "amount"]));
  const currency = (cell(row, ["devise", "currency"]) || "EUR").toUpperCase();
  if (!number) return { ok: false, summary: supplier || "Commande", message: "Le numéro est obligatoire.", key: "" };
  if (!supplier && !cell(row, ["siren"])) return { ok: false, summary: number, message: "Le fournisseur est obligatoire.", key: "" };
  if (amount === null || amount < 0) return { ok: false, summary: number, message: "Montant invalide.", key: "" };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, summary: number, message: "Devise invalide.", key: "" };
  return { ok: true, summary: `${number} · ${supplier}`, message: "Prêt à importer.", key: number.toLowerCase() };
}

function partyFrom(row: CsvRow) {
  return {
    name: cell(row, ["nom", "name"]),
    siren: cell(row, ["siren"]).replace(/\s/g, "") || null,
    vatNumber: cell(row, ["tva", "vat", "vatnumber"]).replace(/\s/g, "").toUpperCase() || null,
    email: cell(row, ["email"]) || null,
    category: cell(row, ["categorie", "catégorie", "category"]) || null,
  };
}

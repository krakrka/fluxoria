import { extractedDocumentSchema, type ExtractedDocument } from "@/ai/schema";
import { IMPORTANT_FIELDS } from "@/lib/field-labels";

export type TextPage = { page: number; text: string };

type Hit = { page: number; line: string; zone: string; value: string };

const EXPECTED = [
  "invoice_number",
  "issue_date",
  "due_date",
  "supplier_name",
  "customer_name",
  "siren",
  "vat_number",
  "amount_ht",
  "amount_vat",
  "amount_ttc",
  "currency",
  "payment_terms",
  "purchase_order_number",
] as const;

export function parseFrenchDocument(pages: TextPage[]): ExtractedDocument {
  const kind = detectKind(pages.map((page) => page.text).join("\n"));
  const warnings: string[] = [];
  const numbers = collect(pages, /^facture\s*n[°o]\s+(.+)$/i, "En-tête");
  const number = numbers[0] ?? search(pages, /^(?:numero|n[°o])\s*:\s*(.+)$/i, "En-tête");
  if (numbers.length > 1) warnings.push("Plusieurs numéros ont été lus.");
  const issue = search(pages, /^date\s*:\s*(.+)$/i, "En-tête");
  const due = search(pages, /^ech[eé]ance\s*:\s*(.+)$/i, "En-tête");
  const supplier = search(pages, /^fournisseur\s*:\s*(.+)$/i, "En-tête");
  const customer = search(pages, /^client\s*:\s*(.+)$/i, "En-tête");
  const siren = search(pages, /^siren\s*:\s*(.+)$/i, "En-tête");
  const vatNumber = search(pages, /^tva intra\s*:\s*(.+)$/i, "En-tête");
  const currency = search(pages, /^devise\s*:\s*([A-Za-z]{3})$/i, "En-tête");
  const terms = search(pages, /^conditions\s*:\s*(.+)$/i, "En-tête");
  const po = search(pages, /^commande\s*:\s*(.+)$/i, "En-tête");
  const amountHt = search(pages, /^total\s*ht\s*:\s*(.+)$/i, "Totaux");
  const amountVat = search(pages, /^tva\s*:\s*(.+)$/i, "Totaux");
  const amountTtc = search(pages, /^total\s*ttc\s*:\s*(.+)$/i, "Totaux");
  const lines = readLines(pages);

  const fields = {
    invoice_number: textField(number, numbers.length > 1 ? 0.55 : undefined),
    issue_date: dateField(issue),
    due_date: dateField(due),
    supplier_name: textField(supplier),
    customer_name: textField(customer),
    siren: sirenField(siren),
    vat_number: textField(vatNumber),
    amount_ht: moneyField(amountHt),
    amount_vat: moneyField(amountVat),
    amount_ttc: moneyField(amountTtc),
    currency: textField(currency ? { ...currency, value: currency.value.toUpperCase() } : null),
    payment_terms: textField(terms),
    purchase_order_number: textField(po),
  };

  const ht = numberOrNull(fields.amount_ht.value);
  const vat = numberOrNull(fields.amount_vat.value);
  const ttc = numberOrNull(fields.amount_ttc.value);
  if (ht !== null && vat !== null && ttc !== null && Math.abs(ht + vat - ttc) > 0.05) {
    warnings.push("Le montant TTC ne correspond pas au HT et à la TVA.");
    fields.amount_ttc = { ...fields.amount_ttc, confidence: Math.min(fields.amount_ttc.confidence, 0.45) };
  }
  if (kind === "SUPPLIER_INVOICE" && lines.length === 0) {
    warnings.push("Aucune ligne extraite.");
  }

  const missing = EXPECTED.filter((key) => fields[key].value === null);
  const confidence = Math.min(...IMPORTANT_FIELDS.map((key) => fields[key]?.confidence ?? 0.2));

  return extractedDocumentSchema.parse({
    detected_document_type: kind,
    confidence,
    warnings,
    missing_fields: missing,
    fields,
    lines,
  });
}

function detectKind(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("bon de livraison")) return "DELIVERY_NOTE";
  if (lower.includes("facture")) return "SUPPLIER_INVOICE";
  if (lower.includes("bon de commande")) return "PURCHASE_ORDER";
  if (lower.includes("devis")) return "QUOTE";
  return "OTHER";
}

function collect(pages: TextPage[], pattern: RegExp, zone: string) {
  const found: Hit[] = [];
  for (const page of pages) {
    for (const raw of page.text.split(/\n/)) {
      const line = raw.trim();
      const match = line.match(pattern);
      if (match?.[1]) found.push({ page: page.page, line, zone, value: match[1].trim() });
    }
  }
  return found;
}

function search(pages: TextPage[], pattern: RegExp, zone: string) {
  return collect(pages, pattern, zone)[0] ?? null;
}

function located(value: string | null, confidence: number, hit: Hit | null) {
  return {
    value,
    confidence,
    page: hit?.page ?? null,
    zone: hit?.zone ?? null,
    source_text: hit ? hit.line.slice(0, 240) : null,
  };
}

function textConfidence(value: string) {
  if (/[?]{2,}/.test(value) || value.replace(/[?\s]/g, "").length < 2) return 0.32;
  return 0.96;
}

function textField(hit: Hit | null, forced?: number) {
  if (!hit) return located(null, 0.2, null);
  return located(hit.value.slice(0, 180), forced ?? textConfidence(hit.value), hit);
}

function dateField(hit: Hit | null) {
  if (!hit) return located(null, 0.2, null);
  const iso = hit.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const french = hit.value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const year = iso?.[1] ?? french?.[3];
  const month = iso?.[2] ?? french?.[2];
  const day = iso?.[3] ?? french?.[1];
  if (!year || !month || !day) return located(null, 0.3, hit);
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() + 1 !== Number(month)) return located(null, 0.3, hit);
  return located(`${year}-${month}-${day}`, 0.96, hit);
}

function moneyField(hit: Hit | null) {
  if (!hit) return located(null, 0.2, null);
  const compact = hit.value.trim();
  if (/[A-Za-z]/.test(compact)) return located(null, 0.28, hit);
  const normalized = compact.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return located(null, 0.3, hit);
  const [whole, fraction = ""] = normalized.split(".");
  return located(`${whole}.${fraction.padEnd(2, "0")}`, 0.96, hit);
}

function sirenField(hit: Hit | null) {
  if (!hit) return located(null, 0.2, null);
  const digits = hit.value.replace(/\s/g, "");
  if (!/^\d{9}$/.test(digits)) return located(null, 0.34, hit);
  return located(digits, 0.9, hit);
}

function readLines(pages: TextPage[]) {
  const pattern = /^LIGNE\s+(.+?)\s+\|\s+([^|]+?)\s+\|\s+([^|]+?)\s+\|\s+([^|]+?)\s+\|\s+([^|]+)$/i;
  const lines = [];
  for (const page of pages) {
    for (const raw of page.text.split(/\n/)) {
      const line = raw.trim();
      const match = line.match(pattern);
      if (!match) continue;
      const hit = { page: page.page, line, zone: "Lignes", value: line };
      const description = textField({ ...hit, value: match[1].trim() });
      const quantity = moneyField({ ...hit, value: match[2].trim() });
      const unitPrice = moneyField({ ...hit, value: match[3].trim() });
      const vatRate = moneyField({ ...hit, value: match[4].trim() });
      const amount = moneyField({ ...hit, value: match[5].trim() });
      lines.push({
        description,
        quantity: { ...quantity, value: quantity.value ? String(Number(quantity.value)) : null },
        unit_price: unitPrice,
        vat_rate: { ...vatRate, value: vatRate.value ? String(Number(vatRate.value)) : null },
        amount_ht: amount,
      });
    }
  }
  return lines;
}

function numberOrNull(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

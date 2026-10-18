import { findValidSirens, vatFromSiren } from "@/lib/siren";
import { buildPdfPages, buildSimplePdf } from "@/services/pdf";

const siren = findValidSirens(1)[0];
const vat = vatFromSiren(siren);

const header = [
  "FACTURE",
  "Facture no FAC-2026-100",
  "Date : 12/03/2026",
  "Echeance : 11/11/2026",
  "Fournisseur : Atelier Lumiere",
  `SIREN : ${siren}`,
  `TVA intra : ${vat}`,
  "Client : Atlas Industrie",
  "Devise : EUR",
  "Conditions : 30 jours",
  "Commande : BC-2026-0142",
];

export function normalInvoice() {
  return pdf("facture-normale.pdf", [
    ...header,
    "LIGNE Fourniture bureau | 2 | 50.00 | 20 | 100.00",
    "Total HT : 100.00",
    "TVA : 20.00",
    "Total TTC : 120.00",
  ]);
}

export function complexInvoice() {
  return pdf("facture-complexe.pdf", [
    ...header,
    "LIGNE Conseil | 3 | 100.00 | 20 | 300.00",
    "LIGNE Livres | 2 | 10.00 | 5.5 | 20.00",
    "Total HT : 320.00",
    "TVA : 61.10",
    "Total TTC : 381.10",
  ]);
}

export function lowQualityInvoice() {
  return pdf("facture-faible.pdf", [
    "FACTURE",
    "Facture no F???",
    "Date : 12/03/2026",
    "Echeance : 11/11/2026",
    "Fournisseur : ???",
    "Client : Atelier Nord",
    "Devise : EUR",
    "Conditions : 30 jours",
    "Commande : BC-2026-0142",
    "Total HT : 1O0,OO",
    "TVA : 2O,OO",
    "Total TTC : 12O,OO",
  ]);
}

export function multiPageInvoice() {
  return {
    filename: "facture-multipage.pdf",
    mimeType: "application/pdf",
    bytes: buildPdfPages([
      header,
      ["LIGNE Fourniture bureau | 2 | 50.00 | 20 | 100.00", "Total HT : 100.00", "TVA : 20.00", "Total TTC : 120.00"],
    ]),
  };
}

export function unknownSupplierInvoice() {
  return pdf("facture-inconnu.pdf", [
    "FACTURE",
    "Facture no FAC-2026-880",
    "Date : 02/02/2026",
    "Echeance : 02/03/2026",
    "Fournisseur : Nordic Components Oy",
    "Client : Atlas Industrie",
    "Devise : EUR",
    "Conditions : 30 jours",
    "Commande : BC-2026-0880",
    "LIGNE Composant | 1 | 40.00 | 20 | 40.00",
    "Total HT : 40.00",
    "TVA : 8.00",
    "Total TTC : 48.00",
  ]);
}

export function foreignCurrencyInvoice() {
  return pdf("facture-usd.pdf", [
    "FACTURE",
    "Facture no INV-2026-USD",
    "Date : 12/03/2026",
    "Echeance : 11/11/2026",
    "Fournisseur : Harbor Supply",
    `SIREN : ${siren}`,
    `TVA intra : ${vat}`,
    "Client : Atlas Industrie",
    "Devise : USD",
    "Conditions : 30 days",
    "Commande : PO-2026-15",
    "LIGNE Parts | 4 | 25.00 | 0 | 100.00",
    "Total HT : 100.00",
    "TVA : 0.00",
    "Total TTC : 100.00",
  ]);
}

export function manyLinesInvoice() {
  const lines = Array.from({ length: 12 }, (_, index) => `LIGNE Article ${index + 1} | 1 | 10.00 | 20 | 10.00`);
  return pdf("facture-lignes.pdf", [
    ...header,
    ...lines,
    "Total HT : 120.00",
    "TVA : 24.00",
    "Total TTC : 144.00",
  ]);
}

export function deliveryNote() {
  return pdf("bon-livraison.pdf", [
    "BON DE LIVRAISON",
    "Numero : BL-2026-3",
    "Date : 12/03/2026",
    "Fournisseur : Atelier Lumiere",
    "Client : Atlas Industrie",
    "Commande : BC-2026-0142",
    "LIGNE Carton | 1 | 0 | 0 | 0",
  ]);
}

export function purchaseOrder() {
  return pdf("bon-commande.pdf", [
    "BON DE COMMANDE",
    "Numero : BC-2026-77",
    "Date : 01/03/2026",
    "Fournisseur : Atelier Lumiere",
    "Client : Atlas Industrie",
    "Devise : EUR",
    "LIGNE Acier | 5 | 12.00 | 20 | 60.00",
    "Total HT : 60.00",
    "TVA : 12.00",
    "Total TTC : 72.00",
  ]);
}

export function scannedPdf() {
  return { filename: "scan.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF") };
}

export function invoiceImage(text = normalInvoiceText()) {
  return { filename: "facture.png", mimeType: "image/png", bytes: pngWithText(text) };
}

export function normalInvoiceText() {
  return [
    ...header,
    "LIGNE Fourniture bureau | 2 | 50.00 | 20 | 100.00",
    "Total HT : 100.00",
    "TVA : 20.00",
    "Total TTC : 120.00",
  ].join("\n");
}

function pdf(filename: string, lines: string[]) {
  return { filename, mimeType: "application/pdf", bytes: buildSimplePdf(lines) };
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function pngCrc(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngWithText(text: string) {
  const data = Buffer.concat([Buffer.from("InvoiceText\0", "latin1"), Buffer.from(text, "latin1")]);
  const body = Buffer.concat([Buffer.from("tEXt"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc(body));
  const chunk = Buffer.concat([length, body, crc]);
  const marker = PNG.lastIndexOf(Buffer.from("IEND"));
  return Buffer.concat([PNG.subarray(0, marker - 4), chunk, PNG.subarray(marker - 4)]);
}

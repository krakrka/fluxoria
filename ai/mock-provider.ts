import { extractedDocumentSchema, type ExtractedDocument, type ExtractedField } from "@/ai/schema";
import { AiProviderError, type AIProvider, type ExtractionInput } from "@/ai/types";

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function field(value: string | number | null, confidence: number): ExtractedField {
  return { value, confidence, validated: false, source: "ai" };
}

const KINDS = [
  "SUPPLIER_INVOICE",
  "CUSTOMER_INVOICE",
  "PURCHASE_ORDER",
  "DELIVERY_NOTE",
  "QUOTE",
  "TRANSPORT_DOCUMENT",
  "OTHER",
] as const;

function detectKind(filename: string, bytes: Buffer, hint?: string) {
  const name = filename.toLowerCase();
  if (hint && hint !== "UNKNOWN") return hint;
  if (/commande|purchase|bon[-_ ]?de[-_ ]?commande|\bbc\b/.test(name)) return "PURCHASE_ORDER";
  if (/client|vente/.test(name)) return "CUSTOMER_INVOICE";
  if (/devis|quote/.test(name)) return "QUOTE";
  if (/livraison|\bbl\b/.test(name)) return "DELIVERY_NOTE";
  if (/transport|cmr/.test(name)) return "TRANSPORT_DOCUMENT";
  if (/facture|invoice/.test(name)) return "SUPPLIER_INVOICE";
  return KINDS[hashString(`${bytes.byteLength}:${bytes.subarray(0, 32).toString("hex")}`) % KINDS.length];
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async extractDocument(input: ExtractionInput): Promise<ExtractedDocument> {
    const filename = input.filename.toLowerCase();
    if (/erreur|error|corrompu/.test(filename)) {
      throw new AiProviderError("Lecture simulée impossible : le fichier est marqué comme illisible.");
    }

    const contentHash = hashString(`${input.bytes.byteLength}:${input.bytes.subarray(0, 48).toString("hex")}:${input.filename}`);
    const hash = contentHash;
    const kind = detectKind(input.filename, input.bytes, input.hintedKind);
    const profile = contentHash % 5;
    const stableDemo = /facture-fournisseur/.test(filename);
    const lowConfidence = !stableDemo && (/flou|review|verifier|ambigu/.test(filename) || profile === 1);
    const amountMismatch = !stableDemo && (/ecart|écart|mismatch/.test(filename) || profile === 2);
    const highAmount = /eleve|élevé|5000|high/.test(filename) || profile === 3;
    const amountHt = highAmount ? 5400 + (hash % 400) : 180 + (hash % 2200);
    const vat = Math.round(amountHt * 0.2 * 100) / 100;
    const ttc = Math.round((amountHt + vat) * 100) / 100;
    const displayedTtc = amountMismatch ? Math.round((ttc + 48) * 100) / 100 : ttc;
    const day = String((hash % 27) + 1).padStart(2, "0");
    const number =
      kind === "PURCHASE_ORDER"
        ? `BC-2026-${String(1000 + (hash % 800)).padStart(4, "0")}`
        : `FAC-2026-${String(1000 + (hash % 8000)).padStart(5, "0")}`;
    const supplier = ["Aciers Durand", "Énergie Rhône", "Bureau Plus", "Transport Loire", "Outillage Martin"][hash % 5];
    const customer = ["Atelier Nord", "BâtiSud", "Cuisine Pro Lyon", "Commune de Val-Fleuri", "Clinique des Cèdres"][hash % 5];
    const poNumber = /rapproche|match|bc-2026-0142/.test(filename) ? "BC-2026-0142" : `BC-2026-${String(1400 + (hash % 20)).padStart(4, "0")}`;
    const amountConfidence = lowConfidence ? 0.54 : 0.97;
    const partyConfidence = lowConfidence ? 0.63 : 0.93;
    const warnings = [
      ...(lowConfidence ? ["Le montant TTC est peu lisible. Une vérification humaine est nécessaire."] : []),
      ...(amountMismatch ? ["Le montant TTC ne correspond pas au HT et à la TVA."] : []),
    ];
    const missing = kind === "OTHER" ? ["invoice_number"] : kind === "PURCHASE_ORDER" ? ["due_date"] : [];

    const document = {
      detected_document_type: kind,
      confidence: kind === "OTHER" ? 0.41 : lowConfidence ? 0.63 : 0.97,
      warnings,
      missing_fields: missing,
      fields: {
        invoice_number: field(kind === "OTHER" ? null : number, kind === "OTHER" ? 0.32 : 0.97),
        issue_date: field(`2026-09-${day}`, 0.95),
        due_date: field(kind === "PURCHASE_ORDER" ? null : `2026-10-${day}`, kind === "PURCHASE_ORDER" ? 0.2 : 0.9),
        supplier_name: field(kind === "CUSTOMER_INVOICE" ? "Atlas Industrie" : supplier, partyConfidence),
        customer_name: field(kind === "CUSTOMER_INVOICE" ? customer : "Atlas Industrie", partyConfidence),
        siren: field(lowConfidence ? null : "552100554", lowConfidence ? 0.4 : 0.88),
        vat_number: field(lowConfidence ? null : "FR44552100554", lowConfidence ? 0.35 : 0.86),
        supplier_siren: field(kind === "CUSTOMER_INVOICE" ? "552100554" : lowConfidence ? null : "552100554", lowConfidence ? 0.4 : 0.88),
        supplier_vat_number: field(lowConfidence ? null : "FR44552100554", lowConfidence ? 0.35 : 0.86),
        customer_siren: field(kind === "CUSTOMER_INVOICE" ? null : "100000009", 0.8),
        customer_vat_number: field(kind === "CUSTOMER_INVOICE" ? null : "FR88100000009", 0.8),
        amount_ht: field(amountHt.toFixed(2), amountConfidence),
        amount_vat: field(vat.toFixed(2), amountConfidence),
        amount_ttc: field(displayedTtc.toFixed(2), amountConfidence),
        currency: field("EUR", 0.99),
        payment_terms: field("30 jours fin de mois", 0.84),
        purchase_order_number: field(kind === "PURCHASE_ORDER" ? number : poNumber, 0.9),
      },
      lines: [
        {
          description: field("Prestation ou marchandise principale", 0.9),
          quantity: field(lowConfidence ? "2" : "4", lowConfidence ? 0.66 : 0.92),
          unit_price: field((amountHt / 4).toFixed(2), amountConfidence),
          vat_rate: field("20", 0.98),
          amount_ht: field(amountHt.toFixed(2), amountConfidence),
        },
      ],
    };

    return extractedDocumentSchema.parse(document);
  }
}

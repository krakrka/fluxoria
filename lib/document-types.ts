export const DOCUMENT_TYPE_CATALOG = [
  { id: "INVOICE", family: "INVOICE", label: "Facture" },
  { id: "SUPPLIER_INVOICE", family: "INVOICE", label: "Facture fournisseur" },
  { id: "CUSTOMER_INVOICE", family: "INVOICE", label: "Facture client" },
  { id: "PURCHASE_ORDER", family: "PURCHASE_ORDER", label: "Bon de commande" },
  { id: "DELIVERY_NOTE", family: "DELIVERY_NOTE", label: "Bon de livraison" },
  { id: "QUOTE", family: "QUOTE", label: "Devis" },
  { id: "TRANSPORT_DOCUMENT", family: "TRANSPORT_DOCUMENT", label: "Document de transport" },
  { id: "CREDIT_NOTE", family: "CREDIT_NOTE", label: "Avoir" },
  { id: "RECEIPT", family: "RECEIPT", label: "Reçu" },
  { id: "QUALITY_DOCUMENT", family: "QUALITY_DOCUMENT", label: "Document qualité" },
  { id: "CMR", family: "CMR", label: "CMR" },
  { id: "INTERVENTION_REPORT", family: "INTERVENTION_REPORT", label: "Rapport d'intervention" },
  { id: "OTHER", family: "OTHER", label: "Autre" },
  { id: "UNKNOWN", family: "OTHER", label: "Type inconnu" },
] as const;

export type DocumentTypeId = (typeof DOCUMENT_TYPE_CATALOG)[number]["id"];

const byId = new Map(DOCUMENT_TYPE_CATALOG.map((entry) => [entry.id, entry]));

export function documentTypeLabel(id: string) {
  return byId.get(id as DocumentTypeId)?.label ?? id;
}

export function kindsForTypeFilter(type: string | undefined) {
  if (!type) return undefined;
  const family = DOCUMENT_TYPE_CATALOG.filter((entry) => entry.family === type).map((entry) => entry.id);
  if (family.length > 1) return family;
  const direct = byId.get(type as DocumentTypeId);
  if (direct) return [direct.id];
  return family.length > 0 ? family : undefined;
}

export function isInvoiceKind(kind: string) {
  return kind === "INVOICE" || kind === "SUPPLIER_INVOICE" || kind === "CUSTOMER_INVOICE";
}

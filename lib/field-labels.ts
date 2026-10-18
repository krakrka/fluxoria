export const FIELD_LABELS: Record<string, string> = {
  invoice_number: "Numéro",
  issue_date: "Date",
  due_date: "Échéance",
  supplier_name: "Fournisseur",
  customer_name: "Client",
  siren: "SIREN",
  vat_number: "TVA intracommunautaire",
  supplier_siren: "SIREN fournisseur",
  supplier_vat_number: "TVA fournisseur",
  customer_siren: "SIREN client",
  customer_vat_number: "TVA client",
  amount_ht: "Montant HT",
  amount_vat: "Montant TVA",
  amount_ttc: "Montant TTC",
  currency: "Devise",
  payment_terms: "Conditions de paiement",
  purchase_order_number: "Numéro de commande",
};

export const IMPORTANT_FIELDS = [
  "invoice_number",
  "amount_ttc",
  "issue_date",
  "supplier_name",
  "customer_name",
] as const;

export const REVIEW_CONFIDENCE = 0.8;

export const DOCUMENT_STATUS_LABEL = {
  RECEIVED: "Reçu",
  PROCESSING: "En traitement",
  PROCESSED: "Traité",
  NEEDS_REVIEW: "À vérifier",
  VALIDATED: "Validé",
  REJECTED: "Rejeté",
  ERROR: "Erreur",
} as const;

export const INVOICE_STATUS_LABEL = {
  DRAFT: "Brouillon",
  SENT: "Envoyée",
  DUE: "À échéance",
  OVERDUE: "En retard",
  PAID: "Payée",
  VALIDATED: "Validée",
  REJECTED: "Rejetée",
} as const;

export const MATCH_STATUS_LABEL = {
  MATCH: "Correspondance",
  PARTIAL_MATCH: "Correspondance partielle",
  MISMATCH: "Écart",
  UNMATCHED: "Non rapprochée",
} as const;

export const ROLE_LABEL = {
  OWNER: "Propriétaire",
  ADMIN: "Admin",
  MANAGER: "Manager",
  ACCOUNTANT: "Comptable",
  MEMBER: "Membre",
} as const;

export const KIND_LABEL = {
  INVOICE: "Facture",
  SUPPLIER_INVOICE: "Facture fournisseur",
  CUSTOMER_INVOICE: "Facture client",
  PURCHASE_ORDER: "Bon de commande",
  DELIVERY_NOTE: "Bon de livraison",
  QUOTE: "Devis",
  TRANSPORT_DOCUMENT: "Document de transport",
  CREDIT_NOTE: "Avoir",
  RECEIPT: "Reçu",
  QUALITY_DOCUMENT: "Document qualité",
  CMR: "CMR",
  INTERVENTION_REPORT: "Rapport d'intervention",
  OTHER: "Autre",
  UNKNOWN: "Type inconnu",
} as const;

export const ANOMALY_TYPE_LABEL = {
  AMOUNT_MISMATCH: "Écart de montant",
  QUANTITY_MISMATCH: "Écart de quantité",
  SUPPLIER_MISMATCH: "Fournisseur différent",
  CURRENCY_MISMATCH: "Devise différente",
  MISSING_PURCHASE_ORDER: "Sans bon de commande",
  DUPLICATE_INVOICE: "Doublon potentiel",
  LOW_CONFIDENCE: "Confiance faible",
  MISSING_REQUIRED_FIELD: "Champ manquant",
} as const;

export const ANOMALY_STATUS_LABEL = {
  OPEN: "Ouverte",
  ACKNOWLEDGED: "Prise en compte",
  RESOLVED: "Résolue",
  IGNORED: "Ignorée",
  SUPERSEDED: "Remplacée",
} as const;

export const ANOMALY_SEVERITY_LABEL = {
  INFO: "Info",
  WARNING: "Avertissement",
  CRITICAL: "Critique",
} as const;

export const REJECT_REASON_LABEL = {
  wrong_document: "Mauvais document",
  duplicate: "Doublon",
  unreadable: "Document illisible",
  supplier_error: "Erreur fournisseur",
  other: "Autre",
} as const;

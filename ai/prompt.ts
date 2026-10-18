export function buildExtractionPrompt(hintedKind?: string) {
  return [
    "Tu extrais des données administratives françaises.",
    "Tu retournes uniquement un objet JSON, sans markdown.",
    "N'invente pas une valeur. Si un champ est illisible ou absent, mets value à null, une confidence basse, et ajoute la clé dans missing_fields.",
    "Chaque champ important a la forme { value, confidence, validated: false, source: \"ai\", page, zone, source_text }.",
    "page est le numero de page, zone est En-tete, Totaux ou Lignes, source_text est le passage lu. Mets null si la provenance est inconnue.",
    "confidence est un nombre entre 0 et 1. Ce n'est pas une certitude.",
    "detected_document_type est l'une de : SUPPLIER_INVOICE, CUSTOMER_INVOICE, PURCHASE_ORDER, DELIVERY_NOTE, QUOTE, OTHER, UNKNOWN.",
    hintedKind ? `Type attendu si le document le confirme : ${hintedKind}.` : "Le type n'est pas connu à l'avance.",
    "Champs attendus : invoice_number, issue_date (YYYY-MM-DD), due_date, supplier_name, customer_name, siren, vat_number, amount_ht, amount_vat, amount_ttc, currency, payment_terms, purchase_order_number.",
    "lines est un tableau de { description, quantity, unit_price, vat_rate, amount_ht }, chaque propriété étant un champ avec confidence.",
    "Ajoute warnings quand le document est ambigu, incomplet ou contradictoire.",
  ].join("\n");
}

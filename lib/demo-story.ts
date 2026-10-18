export const DEMO_PATH = [
  { id: "pdf", title: "PDF facture", number: "FAC-2026-1001", body: "Aciers Durand envoie une facture fournisseur. Le PDF est dans les documents d'Atlas Industrie." },
  { id: "extraction", title: "Extraction", number: "FAC-2026-1001", body: "Les champs portent une valeur et une confiance. Une donnée incertaine reste visible." },
  { id: "supplier", title: "Fournisseur", number: "FAC-2026-1001", body: "La facture est rattachée à Aciers Durand, déjà présent dans les fournisseurs." },
  { id: "po", title: "Bon de commande", number: "BC-2026-0142", body: "Le bon BC-2026-0142 porte les quantités commandées." },
  { id: "matching", title: "Rapprochement", number: "FAC-2026-1001", body: "La facture rapprochée reste sur le bon. Un écart de prix, comme sur FAC-2026-1002, reste affiché." },
  { id: "anomaly", title: "Anomalie", number: "FAC-2026-1002", body: "Écart de montant, facture sans bon (FAC-SANS-BC) ou doublon de FAC-2026-1001." },
  { id: "rule", title: "Règle", number: "", body: "Sous 1 000 € la facture peut être validée seule. Entre 1 000 et 5 000 € elle part au manager. Au-delà, au propriétaire." },
  { id: "decision", title: "Validation ou approbation", number: "FAC-AUTO-700", body: "FAC-AUTO-700 est validée automatiquement. FAC-MGR-2500 attend le manager. FAC-OWN-8000 attend le propriétaire, avec une anomalie critique." },
  { id: "audit", title: "Audit", number: "FAC-AUTO-700", body: "Le journal conserve la règle, l'explication et l'auteur. Rien n'est présenté comme une certitude comptable." },
] as const;

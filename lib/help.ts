export const HELP_ARTICLES = [
  { id: "demarrage", title: "Démarrage", body: "Créez l'organisation, confirmez l'adresse, puis ouvrez Onboarding. Indiquez le secteur et le temps passé aujourd'hui sur une facture. La règle de base s'installe toute seule : validation sous 1 000 €, puis approbation." },
  { id: "documents", title: "Documents", body: "Déposez un PDF ou une image. Le fichier d'origine est conservé. Chaque champ extrait a une valeur, une confiance et un passage source. Corrigez un champ faible avant de valider." },
  { id: "factures", title: "Factures", body: "Une facture fournisseur se rapproche d'un bon de commande. Une facture client peut préparer une relance. La relance n'est pas envoyée sans confirmation." },
  { id: "anomalies", title: "Anomalies", body: "Un écart de montant, un fournisseur différent, un bon manquant ou un numéro déjà vu devient une anomalie. L'application continue : la pièce reste à traiter, elle n'est pas effacée." },
  { id: "approbations", title: "Approbations", body: "Le manager traite les factures de 1 000 à 5 000 €. Le propriétaire traite celles au-dessus. Un rejet demande un commentaire. La décision est journalisée." },
  { id: "automatisations", title: "Automatisations", body: "Une règle regarde le montant, le rapprochement et les anomalies. Elle valide, demande une approbation ou crée une alerte. Elle ne décide pas à la place d'un contrôle quand la confiance est faible." },
  { id: "fournisseurs", title: "Fournisseurs", body: "Les fournisseurs se créent à l'extraction ou à la main. Le SIREN est contrôlé. Une facture reste liée au fournisseur de l'organisation, jamais à celui d'une autre." },
  { id: "import", title: "Import", body: "L'import CSV montre un aperçu avant l'enregistrement. L'envoi multiple accepte un lot de fichiers. Un doublon de fichier déjà reçu dans l'organisation est ignoré." },
  { id: "facturation", title: "Facturation", body: "L'essai, l'usage et le changement de plan sont dans Facturation. Seul le webhook Stripe confirme un paiement. Le retour du navigateur ne change pas le plan. Business reste sur devis tant qu'aucun prix n'est configuré." },
  { id: "securite", title: "Sécurité", body: "Chaque organisation ne voit que ses données. Les sessions durent 12 heures. L'export et la suppression sont dans Paramètres. Le journal d'audit n'est pas effacé avec les documents." },
] as const;

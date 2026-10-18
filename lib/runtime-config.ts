export type ConfigState = "configured" | "not_configured" | "development" | "unhealthy" | "healthy" | "local";

export type EnvClass = "REQUIRED" | "OPTIONAL" | "DEVELOPMENT_ONLY" | "PRODUCTION_ONLY";

export const ENV_CATALOG: Array<{ name: string; class: EnvClass; purpose: string }> = [
  { name: "DATABASE_URL", class: "REQUIRED", purpose: "PostgreSQL" },
  { name: "AUTH_SECRET", class: "REQUIRED", purpose: "Signature des sessions" },
  { name: "AUTH_URL", class: "REQUIRED", purpose: "URL publique attendue par Auth.js" },
  { name: "APP_URL", class: "OPTIONAL", purpose: "Origine publique prioritaire pour les liens email, OAuth et facturation" },
  { name: "STORAGE_DRIVER", class: "REQUIRED", purpose: "local en développement, s3 en production" },
  { name: "STORAGE_LOCAL_DIR", class: "DEVELOPMENT_ONLY", purpose: "Dossier local. Inutilisable comme stockage de production." },
  { name: "S3_BUCKET", class: "PRODUCTION_ONLY", purpose: "Bucket des documents" },
  { name: "S3_REGION", class: "PRODUCTION_ONLY", purpose: "Région du bucket" },
  { name: "S3_ENDPOINT", class: "OPTIONAL", purpose: "Point d'accès compatible S3. Vide pour AWS." },
  { name: "S3_ACCESS_KEY_ID", class: "PRODUCTION_ONLY", purpose: "Identifiant de stockage" },
  { name: "S3_SECRET_ACCESS_KEY", class: "PRODUCTION_ONLY", purpose: "Secret de stockage" },
  { name: "S3_LIVE_CHECK", class: "OPTIONAL", purpose: "true pour autoriser le probe. Vide par défaut." },
  { name: "S3_LIVE_CONFIRM", class: "OPTIONAL", purpose: "isolated pour confirmer un bucket distinct. Le nom ne prouve pas l'isolation." },
  { name: "S3_LIVE_BUCKET", class: "OPTIONAL", purpose: "Bucket du probe, différent de S3_BUCKET." },
  { name: "S3_LIVE_REGION", class: "OPTIONAL", purpose: "Région du bucket de probe." },
  { name: "S3_LIVE_ENDPOINT", class: "OPTIONAL", purpose: "Point d'accès du probe. Vide pour AWS." },
  { name: "S3_LIVE_ACCESS_KEY_ID", class: "OPTIONAL", purpose: "Identifiant dédié au probe, distinct de l'application." },
  { name: "S3_LIVE_SECRET_ACCESS_KEY", class: "OPTIONAL", purpose: "Secret dédié au probe, distinct de l'application." },
  { name: "MAX_UPLOAD_BYTES", class: "OPTIONAL", purpose: "Taille maximale d'un fichier" },
  { name: "MOCK_AI_MODE", class: "DEVELOPMENT_ONLY", purpose: "Extraction simulée. false en production avec une clé." },
  { name: "OPENAI_API_KEY", class: "OPTIONAL", purpose: "Fournisseur d'extraction" },
  { name: "OPENAI_MODEL", class: "OPTIONAL", purpose: "Modèle texte" },
  { name: "OPENAI_VISION_MODEL", class: "OPTIONAL", purpose: "Modèle image" },
  { name: "EMAIL_DELIVERY_ENABLED", class: "OPTIONAL", purpose: "Active l'envoi réel" },
  { name: "EMAIL_API_URL", class: "OPTIONAL", purpose: "Endpoint du fournisseur email interchangeable" },
  { name: "EMAIL_API_KEY", class: "OPTIONAL", purpose: "Jeton du fournisseur email" },
  { name: "SUPPORT_INBOX", class: "OPTIONAL", purpose: "Adresse qui reçoit les demandes de support" },
  { name: "STRIPE_SECRET_KEY", class: "OPTIONAL", purpose: "Facturation. Absente = billing non configuré." },
  { name: "STRIPE_WEBHOOK_SECRET", class: "OPTIONAL", purpose: "Signature des webhooks" },
  { name: "STRIPE_PRICE_STARTER", class: "OPTIONAL", purpose: "Prix Starter" },
  { name: "STRIPE_PRICE_PRO", class: "OPTIONAL", purpose: "Prix Pro" },
  { name: "STRIPE_PRICE_BUSINESS", class: "OPTIONAL", purpose: "Prix Business. Vide = sur devis." },
  { name: "PLAN_STARTER_PRICE_CENTS", class: "OPTIONAL", purpose: "Prix affiché Starter" },
  { name: "PLAN_PRO_PRICE_CENTS", class: "OPTIONAL", purpose: "Prix affiché Pro" },
  { name: "PLAN_BUSINESS_PRICE_CENTS", class: "OPTIONAL", purpose: "Prix affiché Business" },
  { name: "PLAN_STARTER_DOCUMENTS", class: "OPTIONAL", purpose: "Plafond documents Starter" },
  { name: "PLAN_PRO_DOCUMENTS", class: "OPTIONAL", purpose: "Plafond documents Pro" },
  { name: "PLAN_BUSINESS_DOCUMENTS", class: "OPTIONAL", purpose: "Plafond documents Business" },
  { name: "TRIAL_DAYS", class: "OPTIONAL", purpose: "Durée d'essai" },
  { name: "ERROR_TRACKING_URL", class: "OPTIONAL", purpose: "Webhook d'erreurs. Le corps est expurgé." },
  { name: "SENTRY_DSN", class: "OPTIONAL", purpose: "Réservé. Aucun SDK Sentry n'est chargé." },
  { name: "ALERT_WEBHOOK_URL", class: "OPTIONAL", purpose: "Alerte sur erreur, sans secret ni contenu de facture" },
  { name: "LOG_LEVEL", class: "OPTIONAL", purpose: "debug uniquement hors production, sauf demande explicite" },
  { name: "STATUS_LEVEL", class: "OPTIONAL", purpose: "Force operational, degraded ou outage" },
  { name: "STATUS_EDITOR_EMAILS", class: "OPTIONAL", purpose: "Seuls ces emails publient un incident" },
  { name: "BACKUP_CONFIGURED", class: "PRODUCTION_ONLY", purpose: "true quand les sauvegardes PostgreSQL sont planifiées et testées" },
  { name: "EXPOSE_RESET_LINK", class: "DEVELOPMENT_ONLY", purpose: "Affiche le lien de réinitialisation. Interdit au démarrage production." },
  { name: "DEMO_LOGIN_HINT", class: "DEVELOPMENT_ONLY", purpose: "Rappel du compte de démonstration. Ignoré en production." },
  { name: "GOOGLE_CLIENT_ID", class: "OPTIONAL", purpose: "Connecteur Gmail et Drive" },
  { name: "GOOGLE_CLIENT_SECRET", class: "OPTIONAL", purpose: "Secret OAuth Google" },
  { name: "INBOUND_WEBHOOK_SECRET", class: "OPTIONAL", purpose: "Réception email entrante" },
];

function filled(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function demoLoginHint() {
  if (process.env.NODE_ENV === "production") return "";
  return process.env.DEMO_LOGIN_HINT?.trim() || "Compte de démonstration local : owner@atlas-industrie.test · Fluxora-Demo-2026. Ce rappel disparaît en production.";
}

export function assertProductionSafety() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.EXPOSE_RESET_LINK === "true") {
    throw new Error("EXPOSE_RESET_LINK est interdit en production.");
  }
  const origin = process.env.APP_URL || process.env.AUTH_URL || "";
  if (!origin.startsWith("https://")) {
    throw new Error("APP_URL ou AUTH_URL doit être en https en production.");
  }
  if (process.env.STORAGE_DRIVER !== "s3") {
    throw new Error("STORAGE_DRIVER=s3 est obligatoire en production.");
  }
  const missing = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Stockage production incomplet : ${missing.join(", ")}.`);
  }
  const endpoint = process.env.S3_ENDPOINT?.trim();
  if (endpoint && !endpoint.startsWith("https://")) {
    throw new Error("S3_ENDPOINT doit être en https en production.");
  }
}

export function serviceConfiguration() {
  const storageDriver = process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
  const s3Ready = filled("S3_BUCKET") && filled("S3_REGION") && filled("S3_ACCESS_KEY_ID") && filled("S3_SECRET_ACCESS_KEY");
  const emailReady = process.env.EMAIL_DELIVERY_ENABLED === "true" && filled("EMAIL_API_URL") && filled("EMAIL_API_KEY");
  const billingReady = filled("STRIPE_SECRET_KEY") && filled("STRIPE_WEBHOOK_SECRET") && filled("STRIPE_PRICE_STARTER") && filled("STRIPE_PRICE_PRO");
  const aiReady = process.env.MOCK_AI_MODE === "false" && filled("OPENAI_API_KEY");
  return {
    storage: (storageDriver === "s3" ? (s3Ready ? "configured" : "not_configured") : "local") as ConfigState,
    ai: (aiReady ? "configured" : process.env.MOCK_AI_MODE === "false" ? "not_configured" : "development") as ConfigState,
    email: (emailReady ? "configured" : "not_configured") as ConfigState,
    billing: (billingReady ? "configured" : "not_configured") as ConfigState,
    errorTracking: (filled("ERROR_TRACKING_URL") ? "configured" : "not_configured") as ConfigState,
    alerts: (filled("ALERT_WEBHOOK_URL") ? "configured" : "not_configured") as ConfigState,
    backups: (process.env.BACKUP_CONFIGURED === "true" ? "configured" : "not_configured") as ConfigState,
    https: ((process.env.APP_URL || process.env.AUTH_URL || "").startsWith("https://") ? "configured" : "not_configured") as ConfigState,
  };
}

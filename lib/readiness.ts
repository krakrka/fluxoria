import { serviceConfiguration } from "@/lib/runtime-config";

export type ReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export function productionReadiness(): ReadinessItem[] {
  const services = serviceConfiguration();
  const origin = process.env.APP_URL || process.env.AUTH_URL || "";
  const local = origin.includes("localhost") || origin.includes("127.0.0.1");
  return [
    { id: "env", label: "Variables d'environnement", ok: Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET && process.env.AUTH_URL), detail: "DATABASE_URL, AUTH_SECRET et AUTH_URL sont requis. Aucune valeur n'est affichée." },
    { id: "database", label: "Base de données", ok: Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL), detail: "PostgreSQL. Runtime : DATABASE_URL. Migrations Neon : DIRECT_URL, puis npm run db:deploy. Ne pas utiliser prisma db push." },
    { id: "migrations", label: "Migrations", ok: true, detail: "development → prisma migrate dev. staging et production → prisma migrate deploy." },
    { id: "backups", label: "Sauvegardes", ok: services.backups === "configured", detail: "BACKUP_CONFIGURED=true après un essai de restauration. Voir docs/production-backups.md." },
    {
      id: "storage",
      label: "Stockage",
      ok: false,
      detail:
        services.storage === "local"
          ? "Stockage local. La production exige STORAGE_DRIVER=s3. Aucun bucket réel n'a été testé."
          : services.storage === "configured"
            ? "Variables S3 présentes. Aucun bucket réel n'a été testé."
            : "STORAGE_DRIVER=s3 sans les variables requises. Aucun bucket réel n'a été testé.",
    },
    { id: "email", label: "Email", ok: services.email === "configured", detail: "EMAIL_DELIVERY_ENABLED, EMAIL_API_URL et EMAIL_API_KEY. Le fournisseur reste interchangeable." },
    { id: "ai", label: "Extraction", ok: services.ai === "configured", detail: services.ai === "development" ? "Mode simulé. Un client payant a besoin de MOCK_AI_MODE=false et d'une clé." : "Fournisseur d'extraction." },
    { id: "stripe", label: "Facturation", ok: services.billing === "configured", detail: services.billing === "configured" ? "Stripe est configuré. Seul le webhook confirme un paiement." : "Billing non configuré. Stripe n'est pas branché. L'application continue de fonctionner." },
    { id: "monitoring", label: "Suivi d'erreurs", ok: services.errorTracking === "configured", detail: "ERROR_TRACKING_URL reçoit un corps expurgé et un identifiant de corrélation." },
    { id: "logs", label: "Journaux", ok: true, detail: "INFO, WARN et ERROR en production. DEBUG seulement si LOG_LEVEL=debug." },
    { id: "alerts", label: "Alertes", ok: services.alerts === "configured", detail: "ALERT_WEBHOOK_URL, au plus une alerte toutes les 10 secondes." },
    { id: "domain", label: "Domaine", ok: Boolean(origin) && !local, detail: "APP_URL ou AUTH_URL sur le domaine public." },
    { id: "ssl", label: "HTTPS", ok: services.https === "configured", detail: "https obligatoire. HTTP est redirigé en production hors localhost." },
    { id: "jobs", label: "Jobs", ok: true, detail: "Les traitements partent dans le processus Next.js. Ce n'est pas une file distribuée." },
    { id: "legal", label: "Pages légales", ok: false, detail: "PLACEHOLDER JURIDIQUE. Aucune conformité n'est déclarée." },
  ];
}

export type PlanId = "STARTER" | "PRO" | "BUSINESS";

export type PlanDefinition = {
  id: PlanId;
  label: string;
  priceCents: number | null;
  price: string;
  documentsPerMonth: number;
  invoicesPerMonth: number;
  users: number;
  automations: number;
  storageBytes: number;
  benefits: string[];
};

function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function optionalPrice(name: string) {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function formatPlanPrice(cents: number | null) {
  if (cents === null) return "Sur devis";
  return `${cents / 100} € / mois`;
}

export function planCatalog(): Record<PlanId, PlanDefinition> {
  const starter = intEnv("PLAN_STARTER_PRICE_CENTS", 9900);
  const pro = intEnv("PLAN_PRO_PRICE_CENTS", 29900);
  const business = optionalPrice("PLAN_BUSINESS_PRICE_CENTS");
  return {
    STARTER: {
      id: "STARTER",
      label: "Starter",
      priceCents: starter,
      price: formatPlanPrice(starter),
      documentsPerMonth: intEnv("PLAN_STARTER_DOCUMENTS", 100),
      invoicesPerMonth: intEnv("PLAN_STARTER_INVOICES", 100),
      users: intEnv("PLAN_STARTER_USERS", 3),
      automations: intEnv("PLAN_STARTER_AUTOMATIONS", 5),
      storageBytes: intEnv("PLAN_STARTER_STORAGE_BYTES", 1_073_741_824),
      benefits: ["Moins de saisie sur les factures courantes", "Détection des anomalies", "Une règle d'approbation", "Journal des actions"],
    },
    PRO: {
      id: "PRO",
      label: "Pro",
      priceCents: pro,
      price: formatPlanPrice(pro),
      documentsPerMonth: intEnv("PLAN_PRO_DOCUMENTS", 1000),
      invoicesPerMonth: intEnv("PLAN_PRO_INVOICES", 1000),
      users: intEnv("PLAN_PRO_USERS", 15),
      automations: intEnv("PLAN_PRO_AUTOMATIONS", 50),
      storageBytes: intEnv("PLAN_PRO_STORAGE_BYTES", 21_474_836_480),
      benefits: ["Volume adapté à une PME", "Approbations manager et propriétaire", "Automatisations multiples", "Suivi de l'usage du mois"],
    },
    BUSINESS: {
      id: "BUSINESS",
      label: "Business",
      priceCents: business,
      price: formatPlanPrice(business),
      documentsPerMonth: intEnv("PLAN_BUSINESS_DOCUMENTS", 10000),
      invoicesPerMonth: intEnv("PLAN_BUSINESS_INVOICES", 10000),
      users: intEnv("PLAN_BUSINESS_USERS", 100),
      automations: intEnv("PLAN_BUSINESS_AUTOMATIONS", 500),
      storageBytes: intEnv("PLAN_BUSINESS_STORAGE_BYTES", 107_374_182_400),
      benefits: ["Plafonds élevés", "Plusieurs équipes", "Même traçabilité que les autres plans", "Conditions convenues sur devis"],
    },
  };
}

export function limitFor(plan: string) {
  const catalog = planCatalog();
  if (plan === "STARTER" || plan === "PRO" || plan === "BUSINESS") return catalog[plan];
  return catalog.STARTER;
}

export function trialDays() {
  return intEnv("TRIAL_DAYS", 14);
}

export function documentLimitMessage(max: number) {
  return `Vous avez atteint votre limite de ${max} documents ce mois-ci.`;
}

export function invoiceLimitMessage(max: number) {
  return `Vous avez atteint votre limite de ${max} factures ce mois-ci.`;
}

export function userLimitMessage(max: number) {
  return `Vous avez atteint votre limite de ${max} utilisateurs.`;
}

export function automationLimitMessage(max: number) {
  return `Vous avez atteint votre limite de ${max} automatisations.`;
}

export const UPGRADE_HINT = "Passez à un plan supérieur depuis Facturation.";

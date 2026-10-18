import { billingOverview } from "@/services/billing";
import { requirePermission } from "@/server/tenant";
import { checkoutAction, portalAction, cancelSubscriptionAction } from "@/server/actions";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { formatPlanPrice } from "@/lib/plans";
import { billingConfigured } from "@/services/stripe-billing";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  TRIALING: "Essai",
  ACTIVE: "Actif",
  PAST_DUE: "Paiement en retard",
  CANCELED: "Annulé",
  INCOMPLETE: "Incomplet",
} as const;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string }> }) {
  const tenant = await requirePermission("billing.manage");
  const query = await searchParams;
  const overview = await billingOverview(tenant.organizationId).catch(() => null);
  if (!overview) return <EmptyState title="Facturation indisponible" body="L'organisation n'a pas été trouvée." />;
  const { subscription, usage, limits, trialDaysLeft, plans } = overview;
  const period = usage.periodStart.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Abonnement" title="Facturation" description="Le plan change lorsque Stripe confirme le paiement. Le retour du navigateur ne suffit pas." />
      {!billingConfigured() && <p className="rounded-xl border border-line px-4 py-3 text-sm">Billing non configuré</p>}
      {query.checkout === "pending" && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-warning">Paiement en cours de confirmation. Le plan sera mis à jour par le webhook Stripe.</p>}
      {query.checkout === "cancel" && <p className="rounded-xl border border-line px-4 py-3 text-sm">Le paiement a été interrompu. L'abonnement actuel est inchangé.</p>}
      {query.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{query.error}</p>}
      <Panel className="p-5">
        <h2 className="text-sm font-medium">Plan actuel</h2>
        <p className="mt-2 text-2xl font-semibold">{limits.label}</p>
        <p className="mt-1 text-sm text-muted">{formatPlanPrice(limits.priceCents)}</p>
        <p className="mt-3 text-sm">
          {subscription ? STATUS_LABEL[subscription.status] : "Plan enregistré, sans abonnement Stripe"}
          {subscription?.cancelAtPeriodEnd ? " · annulation en fin de période" : ""}
        </p>
        {trialDaysLeft !== null && <p className="mt-2 text-sm">Essai : {trialDaysLeft} jour{trialDaysLeft > 1 ? "s" : ""} restant{trialDaysLeft > 1 ? "s" : ""}.</p>}
        <p className="mt-2 text-sm text-muted">Période : {period}</p>
        {subscription?.currentPeriodEnd && <p className="text-sm text-muted">Fin de période : {subscription.currentPeriodEnd.toLocaleDateString("fr-FR")}</p>}
        {subscription?.latestInvoiceUrl && <a className="mt-3 inline-flex text-sm underline" href={subscription.latestInvoiceUrl}>Voir la facture Stripe</a>}
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-3 text-sm font-medium">Usage</h2>
        <ul className="space-y-2 text-sm">
          <li>Documents : {usage.documents} / {limits.documentsPerMonth}</li>
          <li>Factures : {usage.invoices} / {limits.invoicesPerMonth}</li>
          <li>Utilisateurs : {usage.users} / {limits.users}</li>
          <li>Automatisations exécutées : {usage.automationRuns}</li>
          <li>Stockage : {Math.round(usage.storageBytes / 1_048_576)} Mo / {Math.round(limits.storageBytes / 1_048_576)} Mo</li>
        </ul>
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-3 text-sm font-medium">Changer de plan</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {(["STARTER", "PRO", "BUSINESS"] as const).map((planId) => {
            const plan = plans[planId];
            return (
              <div key={planId} className="rounded-xl border border-line p-4">
                <p className="font-medium">{plan.label}</p>
                <p className="mt-1 text-sm text-muted">{formatPlanPrice(plan.priceCents)}</p>
                <p className="mt-2 text-xs text-muted">{plan.documentsPerMonth} documents · {plan.users} utilisateurs</p>
                {plan.priceCents === null ? (
                  <p className="mt-3 text-sm">Sur devis. Écrivez à l'équipe pour un plan Business.</p>
                ) : (
                  <StatefulForm action={checkoutAction} className="mt-3">
                    <input type="hidden" name="plan" value={planId} />
                    <SubmitButton variant="secondary">Choisir {plan.label}</SubmitButton>
                  </StatefulForm>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatefulForm action={portalAction}><SubmitButton variant="secondary">Portail Stripe</SubmitButton></StatefulForm>
          {subscription?.stripeSubscriptionId && subscription.status === "ACTIVE" && (
            <StatefulForm action={cancelSubscriptionAction}><SubmitButton variant="danger">Annuler en fin de période</SubmitButton></StatefulForm>
          )}
        </div>
      </Panel>
    </div>
  );
}

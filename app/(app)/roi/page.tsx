import { getOperationalKpis } from "@/services/cockpit";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { ROI_DISCLAIMER } from "@/lib/roi";
import { formatEurFromCents } from "@/lib/money";
import { roiSettingsAction } from "@/server/actions";
import { ResetDemoButton } from "@/components/reset-demo-button";
import { organizationIsDemo } from "@/services/demo";
import { Field, Input, PageHeader, Panel } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function RoiPage() {
  const tenant = await requireTenant();
  const [kpis, demo] = await Promise.all([
    getOperationalKpis(tenant.organizationId),
    organizationIsDemo(tenant.organizationId),
  ]);
  const rate = kpis.automationRate === null ? "—" : `${Math.round(kpis.automationRate * 100)} %`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Valeur" title="ROI" description={ROI_DISCLAIMER} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="px-5 py-4">
          <p className="text-sm text-muted">Heures économisées ce mois</p>
          <p className="mt-2 text-2xl font-semibold">{kpis.savedHours.toFixed(1)} h</p>
        </Panel>
        <Panel className="px-5 py-4">
          <p className="text-sm text-muted">Estimation €</p>
          <p className="mt-2 text-2xl font-semibold">{formatEurFromCents(kpis.savedCents)}</p>
        </Panel>
        <Panel className="px-5 py-4">
          <p className="text-sm text-muted">Taux automatisé</p>
          <p className="mt-2 text-2xl font-semibold">{rate}</p>
        </Panel>
      </div>
      <Panel className="p-5 text-sm">
        <p>{kpis.autoValidated} facture(s) auto-validée(s) × {kpis.savedPerInvoice} minutes = {kpis.savedMinutes} minutes estimées.</p>
        <p className="mt-1 text-muted">{kpis.processed} facture(s) fournisseur créée(s) ce mois. Montant traité : {formatEurFromCents(kpis.amountCents)}.</p>
      </Panel>
      {can(tenant.role, "org.update") ? (
        <Panel className="p-5">
          <h2 className="mb-3 text-sm font-medium">Hypothèses</h2>
          <StatefulForm action={roiSettingsAction} className="grid gap-3 md:grid-cols-3">
            <Field label="Coût horaire (€)"><Input name="hourlyEuros" type="number" min={1} step="0.01" defaultValue={kpis.settings.hourlyCostCents / 100} required /></Field>
            <Field label="Minutes par facture manuelle"><Input name="manualMinutes" type="number" min={1} step="1" defaultValue={kpis.settings.manualMinutes} required /></Field>
            <Field label="Minutes par facture automatisée"><Input name="automatedMinutes" type="number" min={0} step="1" defaultValue={kpis.settings.automatedMinutes} required /></Field>
            <div className="md:col-span-3"><SubmitButton>Enregistrer les hypothèses</SubmitButton></div>
          </StatefulForm>
        </Panel>
      ) : (
        <p className="text-sm text-muted">Les hypothèses sont visibles. Seuls le propriétaire et l&apos;admin peuvent les modifier.</p>
      )}
      {demo && can(tenant.role, "org.update") && (
        <Panel className="p-5 text-sm">
          <p className="font-medium">Mode démo</p>
          <p className="mt-1 text-muted">La réinitialisation efface les documents et factures de cette organisation de démonstration, puis restaure les cas 700 € et 2 500 €. Les fournisseurs et les règles restent.</p>
          <div className="mt-3"><ResetDemoButton /></div>
        </Panel>
      )}
    </div>
  );
}

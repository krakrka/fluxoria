import Link from "next/link";
import { getOnboardingChecklist, getOperationalKpis } from "@/services/cockpit";
import { ROI_DISCLAIMER } from "@/lib/roi";
import { recordProductEvent } from "@/services/product-events";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { onboardingAction } from "@/server/actions";
import { Field, Input, PageHeader, Panel } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const tenant = await requireTenant();
  const [checklist, kpis] = await Promise.all([
    getOnboardingChecklist(tenant.organizationId),
    getOperationalKpis(tenant.organizationId),
  ]);
  if (checklist.complete) {
    await recordProductEvent({ organizationId: tenant.organizationId, userId: tenant.userId, name: "onboarding_completed" });
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Démarrage" title="Onboarding" description="Le premier document, la première automatisation, puis la première valeur mesurée." />
      <Panel className="p-5">
        <p className="text-lg font-semibold">Fluxora vous a fait gagner {Math.round(kpis.savedMinutes)} minute{Math.round(kpis.savedMinutes) > 1 ? "s" : ""}.</p>
        <p className="mt-1 text-sm text-muted">{ROI_DISCLAIMER}</p>
      </Panel>
      <Panel className="p-5 text-sm">
        <ul className="space-y-1">
          {checklist.steps.map((step) => (
            <li key={step.id}>{step.done ? "✓" : "□"} {step.label}</li>
          ))}
        </ul>
      </Panel>
      {can(tenant.role, "org.update") && (
        <Panel className="p-5">
          <StatefulForm action={onboardingAction} className="grid gap-3 md:grid-cols-2">
            <Field label="Secteur"><Input name="sector" required placeholder="Métallurgie" /></Field>
            <Field label="Volume mensuel approximatif"><Input name="invoiceVolume" type="number" min={0} step="1" defaultValue={20} required /></Field>
            <Field label="Minutes manuelles par facture"><Input name="manualMinutes" type="number" min={1} defaultValue={12} required /></Field>
            <Field label="Minutes automatisées par facture"><Input name="automatedMinutes" type="number" min={0} defaultValue={4} required /></Field>
            <Field label="Inviter un membre (email, facultatif)"><Input name="inviteEmail" type="email" /></Field>
            <div className="md:col-span-2"><SubmitButton>Enregistrer et installer la règle de base</SubmitButton></div>
          </StatefulForm>
          <p className="mt-3 text-sm text-muted">La règle de base est celle déjà prévue à l&apos;inscription : auto-validation sous 1 000 €, puis approbation manager et propriétaire.</p>
        </Panel>
      )}
      <Link className="text-sm underline" href="/documents">Importer le premier document</Link>
    </div>
  );
}

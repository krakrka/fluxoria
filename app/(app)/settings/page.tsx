import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { PLAN_LIMITS } from "@/services/billing";
import { ROLE_LABEL } from "@/lib/labels";
import { readAutomationSettings } from "@/lib/automation-policy";
import { readConfidenceThresholds } from "@/lib/confidence";
import { automationSettingsAction, deleteAccountAction, deleteOrgAction, inviteAction, organizationAction, removeMemberAction } from "@/server/actions";
import { Field, Input, PageHeader, Panel, Select } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const organization = await prisma.organization.findFirst({ where: { id: tenant.organizationId } });
  if (!organization) notFound();
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: tenant.organizationId },
    include: { user: { select: { name: true, email: true } } },
  });
  const plan = PLAN_LIMITS[organization.plan];
  const automation = readAutomationSettings(organization.settings);
  const confidence = readConfidenceThresholds(organization.settings);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Organisation" title="Paramètres" description="Identité, utilisateurs, conservation et limites du plan. Ceci prépare un cadre RGPD, sans prétendre à une conformité certifiée." />
      <Panel className="p-5">
        <p className="text-sm text-muted">Plan {plan.label}</p>
        <p className="mt-1 text-sm">{plan.documentsPerMonth} documents / mois · {plan.users} utilisateurs · {plan.automations} automatisations · {plan.price}</p>
        <p className="mt-2 text-xs text-muted">Les limites s'appliquent aux documents, aux invitations et aux automatisations. Le propriétaire gère l'abonnement dans Facturation. Stripe confirme le plan payant.</p>
      </Panel>
      {can(tenant.role, "org.update") && (
        <div id="organisation"><Panel className="p-5">
          <StatefulForm action={organizationAction} className="grid gap-3 md:grid-cols-2">
            <Field label="Nom"><Input name="name" defaultValue={organization.name} required /></Field>
            <Field label="SIREN"><Input name="siren" defaultValue={organization.siren ?? ""} /></Field>
            <Field label="SIRET"><Input name="siret" defaultValue={organization.siret ?? ""} /></Field>
            <Field label="TVA"><Input name="vatNumber" defaultValue={organization.vatNumber ?? ""} /></Field>
            <Field label="Adresse"><Input name="addressLine" defaultValue={organization.addressLine ?? ""} /></Field>
            <Field label="Code postal"><Input name="postalCode" defaultValue={organization.postalCode ?? ""} /></Field>
            <Field label="Ville"><Input name="city" defaultValue={organization.city ?? ""} /></Field>
            <Field label="Secteur"><Input name="sector" defaultValue={organization.sector ?? ""} /></Field>
            <Field label="Taille"><Input name="companySize" defaultValue={organization.companySize ?? ""} /></Field>
            <Field label="Conservation (jours)"><Input name="retentionDays" type="number" min={30} max={3650} defaultValue={organization.retentionDays} /></Field>
            <div className="md:col-span-2"><SubmitButton>Enregistrer</SubmitButton></div>
          </StatefulForm>
        </Panel></div>
      )}
      <Panel className="p-5">
        <h2 className="mb-1 text-sm font-medium">Automatisation</h2>
        <p className="mb-3 text-sm text-muted">Ces seuils décident si une facture peut être validée seule, ou si elle remonte à un manager puis au propriétaire. Une confiance sous le seuil moyen demande une vérification humaine.</p>
        {can(tenant.role, "org.update") ? (
          <StatefulForm action={automationSettingsAction} className="grid gap-3 md:grid-cols-2">
            <Field label="Seuil d'auto-validation (€)"><Input name="autoValidateEuros" type="number" min={1} step="0.01" defaultValue={automation.autoValidateCents / 100} required /></Field>
            <Field label="Seuil d'approbation propriétaire (€)"><Input name="managerApprovalEuros" type="number" min={1} step="0.01" defaultValue={automation.managerApprovalCents / 100} required /></Field>
            <Field label="Tolérance de montant (%)"><Input name="amountTolerancePercent" type="number" min={0} step="0.1" defaultValue={automation.amountTolerancePercent} required /></Field>
            <Field label="Tolérance de montant (centimes)"><Input name="amountToleranceCents" type="number" min={0} step="1" defaultValue={automation.amountToleranceCents} required /></Field>
            <Field label="Confiance haute (%)"><Input name="confidenceHigh" type="number" min={1} max={100} defaultValue={confidence.high} required /></Field>
            <Field label="Confiance moyenne (%)"><Input name="confidenceMedium" type="number" min={0} max={99} defaultValue={confidence.medium} required /></Field>
            <div className="md:col-span-2"><SubmitButton>Enregistrer les seuils</SubmitButton></div>
          </StatefulForm>
        ) : (
          <p className="text-sm">Auto-validation sous {automation.autoValidateCents / 100} € · propriétaire dès {automation.managerApprovalCents / 100} €. Seuls le propriétaire et l&apos;admin peuvent modifier ces seuils.</p>
        )}
      </Panel>
      <Panel className="p-5">
        <h2 id="membres" className="mb-3 text-sm font-medium">Membres</h2>
        <ul className="divide-y divide-line text-sm">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3 py-2">
              <span>{member.user.name} · {member.user.email}</span>
              <span className="flex items-center gap-3">
                <span className="text-muted">{ROLE_LABEL[member.role]}</span>
                {can(tenant.role, "members.manage") && member.userId !== tenant.userId && (
                  <StatefulForm action={removeMemberAction}>
                    <input type="hidden" name="memberId" value={member.id} />
                    <SubmitButton variant="secondary">Retirer</SubmitButton>
                  </StatefulForm>
                )}
              </span>
            </li>
          ))}
        </ul>
        {can(tenant.role, "members.manage") && (
          <StatefulForm action={inviteAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Nom"><Input name="name" required /></Field>
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Mot de passe temporaire"><Input name="password" type="password" required /></Field>
            <Field label="Rôle">
              <Select name="role" defaultValue="MEMBER">
                {tenant.role === "OWNER" && <option value="ADMIN">Admin</option>}
                <option value="MANAGER">Manager</option>
                <option value="MEMBER">Membre</option>
                <option value="ACCOUNTANT">Comptable</option>
              </Select>
            </Field>
            <div className="md:col-span-2"><SubmitButton>Créer l'utilisateur</SubmitButton></div>
          </StatefulForm>
        )}
      </Panel>
      <div id="confidentialite"><Panel className="p-5 text-sm">
        <h2 className="font-medium">Confidentialité</h2>
        <p className="mt-1 text-muted">Le consentement de création de compte couvre le traitement des documents et les emails nécessaires au service. Il n'y a pas d'email commercial séparé. Les documents plus anciens que la durée de conservation sont retirés du stockage. Les journaux d'audit restent attachés à l'organisation, même après suppression.</p>
        <p className="mt-2">Conservation : {organization.retentionDays} jours.</p>
        {can(tenant.role, "gdpr.export") && (
          <a className="mt-3 inline-flex h-10 items-center rounded-lg border border-line px-4" href="/api/gdpr/export">
            Exporter les données
          </a>
        )}
        <StatefulForm action={deleteAccountAction} className="mt-4 flex flex-wrap gap-2">
          <Input name="confirm" placeholder={tenant.email} aria-label="Confirmer l'email pour supprimer le compte" />
          <SubmitButton variant="danger">Supprimer mon compte</SubmitButton>
        </StatefulForm>
      </Panel></div>
      <div id="securite"><Panel className="p-5 text-sm">
        <h2 className="font-medium">Sécurité</h2>
        <p className="mt-1 text-muted">Les sessions durent 12 heures. Les actions métier restent dans le journal. Le mode démo bloque la suppression et le changement du nom ou du SIREN.</p>
      </Panel></div>
      {can(tenant.role, "org.delete") && (
        <Panel className="p-5">
          <h2 className="text-sm font-medium text-danger">Supprimer l'organisation</h2>
          <p className="mt-1 text-sm text-muted">Saisissez votre email pour confirmer. Les documents et les membres sont retirés. Le journal d'audit est conservé sur l'organisation fermée.</p>
          <form action={deleteOrgAction} className="mt-3 flex gap-2">
            <Input name="confirm" placeholder={tenant.email} />
            <SubmitButton variant="danger">Supprimer</SubmitButton>
          </form>
        </Panel>
      )}
    </div>
  );
}

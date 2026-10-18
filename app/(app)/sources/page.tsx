import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { GMAIL_SCOPES } from "@/connectors/email/gmail";
import { DRIVE_SCOPES } from "@/connectors/files/google-drive";
import { OUTLOOK_SCOPES } from "@/connectors/email/outlook";
import { ONEDRIVE_SCOPES } from "@/connectors/files/onedrive";
import { isDemoOrganization } from "@/lib/roi";
import { enablePennylaneFixtureAction, savePennylaneTokenAction, syncPennylaneAction } from "@/server/actions";
import { EmptyState, Field, Input, PageHeader, Panel } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

const READY = new Set(["FLUXORA_INBOX", "GMAIL", "GOOGLE_DRIVE", "PENNYLANE"]);

export default async function SourcesPage() {
  const tenant = await requireTenant();
  if (!can(tenant.role, "connectors.manage")) {
    return <EmptyState title="Accès limité" body="Les connecteurs sont réservés au propriétaire et à l'admin." />;
  }
  const [accounts, organization] = await Promise.all([
    prisma.connectorAccount.findMany({ where: { organizationId: tenant.organizationId } }),
    prisma.organization.findFirst({ where: { id: tenant.organizationId }, select: { settings: true } }),
  ]);
  const byProvider = new Map(accounts.map((account) => [account.provider, account]));
  const pennylane = byProvider.get("PENNYLANE");
  const demo = isDemoOrganization(organization?.settings);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Connecteurs" title="Sources" description="Chaque source passe par une interface. Le métier ne connaît ni Gmail, ni Drive, ni Pennylane." />
      <div className="grid gap-3 md:grid-cols-2">
        <ConnectorCard name="Boîte Fluxora" state="Actif" detail="Réception des pièces jointes, sans le corps du message." />
        <ConnectorCard name="Gmail" state={byProvider.get("GMAIL")?.status ?? "DISCONNECTED"} detail={`OAuth, scope ${GMAIL_SCOPES[0]}. Le client Google se configure par variable d'environnement.`} />
        <ConnectorCard name="Outlook" state="Non branché" detail={`Interface prête. Scope prévu : ${OUTLOOK_SCOPES[0]}.`} />
        <ConnectorCard name="Google Drive" state={byProvider.get("GOOGLE_DRIVE")?.status ?? "DISCONNECTED"} detail={`Lecture seule. Scope ${DRIVE_SCOPES[0]}.`} />
        <ConnectorCard name="OneDrive" state="Non branché" detail={`Interface prête. Scope prévu : ${ONEDRIVE_SCOPES[0]}.`} />
        <ConnectorCard name="Sage" state="Non branché" detail="Même interface que Pennylane, pas encore branché." />
        <ConnectorCard name="Cegid" state="Non branché" detail="Même interface que Pennylane, pas encore branché." />
        <ConnectorCard name="EBP" state="Non branché" detail="Même interface que Pennylane, pas encore branché." />
      </div>
      <Panel className="p-5">
        <h2 className="text-sm font-medium">Pennylane</h2>
        <p className="mt-1 text-sm text-muted">Récupère les fournisseurs et les factures, puis peut exporter une facture déjà validée. Le jeton est chiffré. État : {pennylane?.status ?? "DISCONNECTED"}{pennylane?.lastError ? ` · ${pennylane.lastError}` : ""}</p>
        <StatefulForm action={savePennylaneTokenAction} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Jeton d'API"><Input name="token" type="password" required minLength={8} /></Field>
          <SubmitButton>Enregistrer le jeton</SubmitButton>
        </StatefulForm>
        <StatefulForm action={syncPennylaneAction} className="mt-3">
          <SubmitButton>Synchroniser</SubmitButton>
        </StatefulForm>
        {demo && (
          <form action={enablePennylaneFixtureAction} className="mt-3">
            <SubmitButton variant="secondary">Utiliser le jeu de démonstration</SubmitButton>
          </form>
        )}
      </Panel>
      <p className="text-xs text-muted">Connecteurs prêts dans le registre : {[...READY].join(", ")}. Outlook, OneDrive, Sage, Cegid et EBP refusent l'appel tant qu'ils ne sont pas branchés.</p>
    </div>
  );
}

function ConnectorCard({ name, state, detail }: { name: string; state: string; detail: string }) {
  return (
    <Panel className="px-4 py-3 text-sm">
      <p className="font-medium">{name}</p>
      <p className="text-xs text-muted">{state}</p>
      <p className="mt-1 text-muted">{detail}</p>
    </Panel>
  );
}

import { requireTenant } from "@/server/tenant";
import { supportAction } from "@/server/actions";
import { listSupportRequests } from "@/services/support";
import { Field, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND = { contact: "Contact", bug: "Anomalie technique", help: "Demande d'aide" } as const;

export default async function SupportPage() {
  const tenant = await requireTenant();
  const requests = await listSupportRequests(tenant.organizationId);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Support" title="Contacter Fluxora" description="La demande garde l'organisation, l'auteur, la page et un court contexte. N'y collez ni mot de passe, ni pièce, ni numéro de carte." />
      <Panel className="p-5">
        <StatefulForm action={supportAction} className="space-y-3">
          <Field label="Type">
            <Select name="kind" defaultValue="help">
              <option value="contact">Contact</option>
              <option value="bug">Anomalie technique</option>
              <option value="help">Demande d&apos;aide</option>
            </Select>
          </Field>
          <Field label="Page concernée">
            <Select name="page" defaultValue="/support">
              <option value="/dashboard">Tableau de bord</option>
              <option value="/documents">Documents</option>
              <option value="/invoices">Factures</option>
              <option value="/billing">Facturation</option>
              <option value="/support">Support</option>
            </Select>
          </Field>
          <Field label="Message">
            <Textarea name="message" required minLength={10} maxLength={2000} placeholder="Ce qui bloque, sans donnée sensible." />
          </Field>
          <SubmitButton>Envoyer</SubmitButton>
        </StatefulForm>
      </Panel>
      <section className="space-y-3">
        {requests.map((request) => (
          <Panel key={request.id} className="p-5 text-sm">
            <p className="font-medium">{KIND[request.kind as keyof typeof KIND] ?? request.kind} · {request.page}</p>
            <p className="mt-2">{request.message}</p>
            <p className="mt-2 text-xs text-muted">{request.user.name} · {request.context} · {formatDateTime(request.createdAt)}</p>
          </Panel>
        ))}
      </section>
    </div>
  );
}

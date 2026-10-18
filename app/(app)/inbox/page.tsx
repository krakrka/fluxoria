import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { formatDateTime } from "@/lib/format";
import { receiveInboxEmailAction } from "@/server/actions";
import { ensureInbox } from "@/services/email-ingestion";
import { EmptyState, Field, Input, PageHeader, Panel } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const tenant = await requireTenant();
  const inbox = await ensureInbox(tenant.organizationId);
  const messages = await prisma.inboundMessage.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { receivedAt: "desc" },
    take: 30,
    include: { attachments: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Réception"
        title="Boîte Fluxora"
        description="Les pièces jointes envoyées à cette adresse deviennent des documents, puis suivent le traitement habituel. Le corps des emails n'est pas conservé."
      />
      <Panel className="p-5 text-sm">
        <p className="text-muted">Adresse d'import</p>
        <p className="mt-1 font-medium">{inbox.externalAccountId}</p>
        <p className="mt-2 text-muted">Transférez les factures vers cette adresse. Le formulaire ci-dessous dépose une pièce jointe dans le même circuit, sans upload manuel du document.</p>
      </Panel>
      <Panel className="p-5">
        <StatefulForm action={receiveInboxEmailAction} className="grid gap-3 md:grid-cols-2">
          <Field label="Email source"><Input name="from" type="email" required placeholder="fournisseur@exemple.fr" /></Field>
          <Field label="Objet"><Input name="subject" placeholder="Facture mars" /></Field>
          <Field label="Pièces jointes">
            <Input name="files" type="file" multiple required accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" />
          </Field>
          <div className="flex items-end"><SubmitButton>Recevoir dans la boîte</SubmitButton></div>
        </StatefulForm>
      </Panel>
      {messages.length === 0 ? (
        <EmptyState title="Aucun email reçu" body="Les messages transférés et leurs pièces jointes apparaîtront ici, avec le statut de traitement." />
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <Panel key={message.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{message.sourceAddress}</p>
                <p className="text-xs text-muted">{formatDateTime(message.receivedAt)} · {message.status}</p>
              </div>
              {message.subject && <p className="text-muted">{message.subject}</p>}
              <ul className="mt-2 space-y-1">
                {message.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    {attachment.filename} · {attachment.status}
                    {attachment.error ? ` · ${attachment.error}` : ""}
                    {attachment.documentId ? ` · document ${attachment.documentId.slice(-6)}` : ""}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { ANOMALY_SEVERITY_LABEL, ANOMALY_STATUS_LABEL, ANOMALY_TYPE_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { anomalyStatusAction } from "@/server/actions";
import { PageHeader, Panel, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AnomalyPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requirePermission("invoices.read");
  const { id } = await params;
  const anomaly = await prisma.anomaly.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: {
      supplier: true,
      invoice: true,
      document: true,
      purchaseOrder: true,
      resolvedBy: { select: { name: true } },
    },
  });
  if (!anomaly) notFound();
  const events = await prisma.auditLog.findMany({
    where: { organizationId: tenant.organizationId, entityType: "Anomaly", entityId: anomaly.id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true } } },
  });
  const editable = can(tenant.role, "invoices.update") && (anomaly.status === "OPEN" || anomaly.status === "ACKNOWLEDGED");

  return (
    <div>
      <PageHeader
        eyebrow={ANOMALY_TYPE_LABEL[anomaly.type]}
        title={anomaly.title}
        description={anomaly.description}
        action={<StatusBadge status={anomaly.severity} label={ANOMALY_SEVERITY_LABEL[anomaly.severity]} />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="space-y-2 p-5 text-sm">
          <p>Statut : {ANOMALY_STATUS_LABEL[anomaly.status]}</p>
          <p>Attendu : {anomaly.expectedValue ?? "—"}</p>
          <p>Constaté : {anomaly.actualValue ?? "—"}</p>
          <p>Facture potentiellement dupliquée : {anomaly.type === "DUPLICATE_INVOICE" ? "oui, aucune facture n'a été supprimée." : "non"}</p>
          {anomaly.invoice && <p><Link className="underline" href={`/invoices/${anomaly.invoice.id}`}>Facture {anomaly.invoice.number}</Link></p>}
          {anomaly.document && <p><Link className="underline" href={`/documents/${anomaly.document.id}`}>Document {anomaly.document.filename}</Link></p>}
          {anomaly.supplier && <p><Link className="underline" href={`/suppliers/${anomaly.supplier.id}`}>Fournisseur {anomaly.supplier.name}</Link></p>}
          {anomaly.purchaseOrder && <p><Link className="underline" href={`/orders/${anomaly.purchaseOrder.id}`}>Commande {anomaly.purchaseOrder.number}</Link></p>}
          {anomaly.resolvedBy && <p>Clos par {anomaly.resolvedBy.name} le {formatDateTime(anomaly.resolvedAt)}</p>}
        </Panel>
        <div className="space-y-4">
          {editable && (
            <Panel className="space-y-3 p-5">
              <form action={anomalyStatusAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="anomalyId" value={anomaly.id} />
                <input name="comment" placeholder="Commentaire" aria-label="Commentaire" className="h-10 flex-1 rounded-lg border border-line px-3 text-sm" />
                <button name="status" value="ACKNOWLEDGED" className="h-10 rounded-lg border border-line px-3 text-sm" type="submit">Prendre en compte</button>
                <button name="status" value="RESOLVED" className="h-10 rounded-lg bg-accent px-3 text-sm text-accent-foreground" type="submit">Résoudre</button>
                <button name="status" value="IGNORED" className="h-10 rounded-lg border border-line px-3 text-sm" type="submit">Ignorer</button>
              </form>
              <p className="text-xs text-muted">La décision est enregistrée dans le journal, avec l&apos;utilisateur et la date.</p>
            </Panel>
          )}
          <Panel className="p-5">
            <h2 className="mb-3 text-sm font-medium">Historique</h2>
            {events.length === 0 ? <p className="text-sm text-muted">Création enregistrée avec la facture.</p> : (
              <ul className="space-y-2 text-sm">
                {events.map((event) => (
                  <li key={event.id}>{formatDateTime(event.createdAt)} · {event.action} · {event.user?.name ?? "Système"}</li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

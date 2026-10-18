import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { INVOICE_STATUS_LABEL, MATCH_STATUS_LABEL } from "@/lib/labels";
import { daysLate, formatDate, formatMoney } from "@/lib/format";
import { getMatchForInvoice } from "@/services/documents";
import { linkOrderAction, linkSupplierAction, paidAction, reminderConfirmAction, reminderDraftAction } from "@/server/actions";
import { ANOMALY_SEVERITY_LABEL, ANOMALY_STATUS_LABEL } from "@/lib/labels";
import { PageHeader, Panel, StatusBadge } from "@/components/ui";
import { FilePreview } from "@/components/file-preview";
import { SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function InvoicePage({ params }: Params) {
  const tenant = await requirePermission("invoices.read");
  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: {
      supplier: true,
      customer: true,
      document: { select: { id: true, filename: true, mimeType: true } },
      matchedPurchaseOrder: { select: { id: true, number: true } },
      anomalies: { orderBy: { createdAt: "desc" } },
      reminders: { orderBy: { createdAt: "desc" } },
      payments: true,
    },
  });
  if (!invoice) notFound();
  const autoAudit = invoice.autoValidated
    ? await prisma.auditLog.findFirst({
        where: { organizationId: tenant.organizationId, entityId: invoice.id, action: "invoice.auto_validated" },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const autoReasons = Array.isArray((autoAudit?.newValue as { explanation?: unknown } | null)?.explanation)
    ? ((autoAudit?.newValue as { explanation: string[] }).explanation)
    : [];
  const [suppliers, orders, match] = await Promise.all([
    prisma.supplier.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: "asc" } }),
    prisma.purchaseOrder.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { number: "asc" } }),
    getMatchForInvoice(tenant.organizationId, invoice.id),
  ]);
  const editable = can(tenant.role, "invoices.update");
  const late = invoice.status === "OVERDUE" ? daysLate(invoice.dueAt) : 0;

  return (
    <div>
      <PageHeader
        eyebrow={invoice.direction === "CUSTOMER" ? "Facture client" : "Facture fournisseur"}
        title={invoice.number}
        description={`${formatMoney(invoice.amountTtc)} · échéance ${formatDate(invoice.dueAt)}${late ? ` · retard ${late} jours` : ""}`}
        action={
          <div className="flex gap-2">
            <StatusBadge status={invoice.status} label={INVOICE_STATUS_LABEL[invoice.status]} />
            <StatusBadge status={invoice.matchStatus} label={MATCH_STATUS_LABEL[invoice.matchStatus]} />
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel className="space-y-3 p-5 text-sm">
          <p>Tiers : {invoice.supplier ? <Link className="underline" href={`/suppliers/${invoice.supplier.id}`}>{invoice.supplier.name}</Link> : invoice.customer?.name ?? "Non associé"}</p>
          <p>Catégorie : {invoice.category ?? "—"}</p>
          <p>Commande : {invoice.matchedPurchaseOrder ? <Link className="underline" href={`/orders/${invoice.matchedPurchaseOrder.id}`}>{invoice.matchedPurchaseOrder.number}</Link> : invoice.purchaseOrderNumber ?? "—"}</p>
          <p>Conditions : {invoice.paymentTerms ?? "—"}</p>
          <p>Rapprochée : {invoice.reconciled ? "Oui" : "Non"}</p>
          {invoice.autoValidated && (
            <div className="rounded-lg border border-line bg-surface px-3 py-3">
              <p className="font-medium">Validée automatiquement par Fluxora</p>
              {autoReasons.length > 0 && (
                <ul className="mt-2 space-y-1 text-muted">
                  {autoReasons.map((reason) => <li key={reason}>✓ {reason}</li>)}
                </ul>
              )}
            </div>
          )}
          {invoice.documentId && (
            <Link className="inline-block text-accent underline" href={`/documents/${invoice.documentId}`}>
              Voir le document source
            </Link>
          )}
          {editable && invoice.status !== "PAID" && (
            <form action={paidAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <SubmitButton variant="secondary">Marquer payée</SubmitButton>
            </form>
          )}
        </Panel>
        <div className="space-y-4">
          {editable && (
            <Panel className="space-y-3 p-5">
              <h2 className="text-sm font-medium">Associer un fournisseur</h2>
              <form action={linkSupplierAction} className="flex gap-2">
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <select name="supplierId" className="h-10 w-full rounded-lg border border-line px-3 text-sm" defaultValue={invoice.supplierId ?? ""}>
                  <option value="">Choisir</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                <SubmitButton>Lier</SubmitButton>
              </form>
              <h2 className="pt-2 text-sm font-medium">Associer une commande</h2>
              <form action={linkOrderAction} className="flex gap-2">
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <select name="purchaseOrderId" className="h-10 w-full rounded-lg border border-line px-3 text-sm" defaultValue={invoice.matchedPurchaseOrderId ?? ""}>
                  <option value="">Choisir</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.number}
                    </option>
                  ))}
                </select>
                <SubmitButton>Comparer</SubmitButton>
              </form>
            </Panel>
          )}
          {invoice.direction === "CUSTOMER" && can(tenant.role, "reminders.manage") && (
            <Panel className="space-y-3 p-5">
              <h2 className="text-sm font-medium">Relance</h2>
              <p className="text-sm text-muted">Le brouillon n'est jamais envoyé sans confirmation, et l'envoi réel reste désactivé.</p>
              <form action={reminderDraftAction}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <SubmitButton variant="secondary">Préparer une relance</SubmitButton>
              </form>
              {invoice.reminders.map((reminder) => (
                <div key={reminder.id} className="rounded-xl bg-background p-3 text-sm">
                  <p className="font-medium">{reminder.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted">{reminder.body}</p>
                  <p className="mt-2 text-xs">Statut : {reminder.status}</p>
                  {reminder.status === "DRAFT" && (
                    <form action={reminderConfirmAction} className="mt-2">
                      <input type="hidden" name="reminderId" value={reminder.id} />
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <SubmitButton>Confirmer sans envoyer</SubmitButton>
                    </form>
                  )}
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>
      {invoice.document && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium">Document</h2>
          <Panel className="p-4">
            <FilePreview id={invoice.document.id} filename={invoice.document.filename} mimeType={invoice.document.mimeType} />
          </Panel>
        </section>
      )}
      {match && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium">Rapprochement : {match.score} %</h2>
          <p className="mb-3 text-xs text-muted">Score d&apos;aide à la décision, pas une certitude.</p>
          <ul className="grid gap-2 sm:grid-cols-5">
            {match.checks.map((check) => (
              <li key={check.key} className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
                <span className="font-medium">{check.label}</span>
                <span className="mt-1 block text-muted">{check.state === "ok" ? "✓" : check.state === "warning" ? "⚠" : "✗"} {check.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium">Anomalies</h2>
        {invoice.anomalies.length === 0 ? <p className="text-sm text-muted">Aucune anomalie liée.</p> : (
          <ul className="space-y-2 text-sm">
            {invoice.anomalies.map((anomaly) => (
              <li key={anomaly.id}>
                <Link className="font-medium underline" href={`/anomalies/${anomaly.id}`}>{anomaly.title}</Link>
                <span className="text-muted"> · {ANOMALY_SEVERITY_LABEL[anomaly.severity]} · {ANOMALY_STATUS_LABEL[anomaly.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium">Écarts de rapprochement</h2>
        {!match ? (
          <p className="text-sm text-muted">Aucune commande associée. Les écarts ne sont pas masqués : il n'y a simplement pas encore de comparaison.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Champ</th>
                  <th className="px-4 py-3 font-medium">Facture</th>
                  <th className="px-4 py-3 font-medium">Commande</th>
                  <th className="px-4 py-3 font-medium">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {match.diffs.map((diff) => (
                  <tr key={diff.field} className="border-t border-line">
                    <td className="px-4 py-3">{diff.label}</td>
                    <td className="px-4 py-3">{diff.invoice}</td>
                    <td className="px-4 py-3">{diff.order}</td>
                    <td className={`px-4 py-3 ${diff.equal ? "text-accent" : "text-danger"}`}>{diff.equal ? "Identique" : "Écart"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

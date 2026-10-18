import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/tenant";
import { formatDate, formatMoney } from "@/lib/format";
import { MATCH_STATUS_LABEL } from "@/lib/labels";
import { approvalDecisionAction } from "@/server/actions";
import { PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requirePermission("approvals.manage");
  const { id } = await params;
  const approval = await prisma.approval.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: {
      invoice: {
        include: {
          supplier: true,
          matchedPurchaseOrder: true,
          anomalies: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } },
        },
      },
    },
  });
  if (!approval) notFound();
  const reasons = Array.isArray(approval.explanation) ? (approval.explanation as string[]) : [];
  const invoice = approval.invoice;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Décision" title={invoice?.number ?? "Approbation"} description={approval.reason} />
      <Panel className="space-y-2 p-5 text-sm">
        <h2 className="font-medium">Pourquoi cette approbation est nécessaire</h2>
        <ul className="space-y-1 text-muted">
          {reasons.length === 0 && <li>{approval.reason}</li>}
          {reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        <p>Facture : {invoice ? <Link className="underline" href={`/invoices/${invoice.id}`}>{invoice.number}</Link> : "—"}</p>
        <p>Fournisseur : {invoice?.supplier?.name ?? "—"}</p>
        <p>Montant : {invoice ? formatMoney(invoice.amountTtc) : formatMoney((approval.amountCents / 100).toFixed(2))}</p>
        <p>Commande : {invoice?.matchedPurchaseOrder?.number ?? invoice?.purchaseOrderNumber ?? "—"}</p>
        <p>Rapprochement : {invoice ? MATCH_STATUS_LABEL[invoice.matchStatus] : "—"}</p>
        <p>Anomalies ouvertes : {invoice?.anomalies.length ?? 0}</p>
        {invoice?.anomalies.map((anomaly) => <p key={anomaly.id} className="text-muted">{anomaly.title}</p>)}
        {invoice?.issuedAt && <p className="text-muted">Émise le {formatDate(invoice.issuedAt)}</p>}
      </Panel>
      {approval.status === "PENDING" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel className="p-5">
            <form action={approvalDecisionAction}>
              <input type="hidden" name="approvalId" value={approval.id} />
              <input type="hidden" name="decision" value="APPROVED" />
              <SubmitButton>Approuver</SubmitButton>
            </form>
          </Panel>
          <Panel className="p-5">
            <form action={approvalDecisionAction} className="space-y-3">
              <input type="hidden" name="approvalId" value={approval.id} />
              <input type="hidden" name="decision" value="REJECTED" />
              <label className="block text-sm">
                Commentaire
                <textarea name="comment" required className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2" rows={3} />
              </label>
              <SubmitButton variant="danger">Rejeter</SubmitButton>
            </form>
          </Panel>
        </div>
      )}
    </div>
  );
}

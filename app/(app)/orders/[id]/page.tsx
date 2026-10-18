import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { formatMoney } from "@/lib/format";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function OrderPage({ params }: Params) {
  const tenant = await requireTenant();
  const { id } = await params;
  const order = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: {
      supplier: true,
      lines: { orderBy: { position: "asc" } },
      matchedInvoices: true,
    },
  });
  if (!order) notFound();

  return (
    <div>
      <PageHeader eyebrow="Bon de commande" title={order.number} description={order.supplier?.name ?? "Fournisseur non associé"} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-5 text-sm">
          <p>Montant TTC : {formatMoney(order.amountTtc)}</p>
          <p className="mt-2">Statut : {order.status}</p>
          {order.documentId && (
            <Link className="mt-3 inline-block text-accent underline" href={`/documents/${order.documentId}`}>
              Voir le document
            </Link>
          )}
        </Panel>
        <Panel className="p-5 text-sm">
          <h2 className="font-medium">Factures rapprochées</h2>
          <ul className="mt-2 space-y-1">
            {order.matchedInvoices.length === 0 && <li className="text-muted">Aucune facture liée.</li>}
            {order.matchedInvoices.map((invoice) => (
              <li key={invoice.id}>
                <Link className="underline" href={`/invoices/${invoice.id}`}>
                  {invoice.number}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Ligne</th>
              <th className="px-4 py-3 font-medium">Quantité</th>
              <th className="px-4 py-3 font-medium">Prix</th>
              <th className="px-4 py-3 font-medium">HT</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className="border-t border-line">
                <td className="px-4 py-3">{line.description}</td>
                <td className="px-4 py-3">{line.quantity.toString()}</td>
                <td className="px-4 py-3">{formatMoney(line.unitPrice)}</td>
                <td className="px-4 py-3">{formatMoney(line.amountHt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

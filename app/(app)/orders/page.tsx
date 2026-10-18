import Link from "next/link";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const tenant = await requireTenant();
  const orders = await prisma.purchaseOrder.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { createdAt: "desc" },
    include: { supplier: true, _count: { select: { matchedInvoices: true } } },
  });

  return (
    <div>
      <PageHeader eyebrow="Achats" title="Commandes" description="Bons de commande utilisés pour rapprocher les factures fournisseurs." />
      {orders.length === 0 ? (
        <EmptyState title="Aucune commande" body="Déposez un bon de commande pour l'ajouter ici." href="/documents" action="Déposer un document" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Numéro</th>
                <th className="px-4 py-3 font-medium">Fournisseur</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">TTC</th>
                <th className="px-4 py-3 font-medium">Factures liées</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <Link className="font-medium hover:underline" href={`/orders/${order.id}`}>
                      {order.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{order.supplier?.name ?? "—"}</td>
                  <td className="px-4 py-3">{formatDate(order.issuedAt)}</td>
                  <td className="px-4 py-3">{formatMoney(order.amountTtc)}</td>
                  <td className="px-4 py-3">{order._count.matchedInvoices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant();
  const { id } = await params;
  const supplier = await prisma.supplier.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: {
      invoices: { orderBy: { issuedAt: "desc" }, take: 8, include: { _count: { select: { anomalies: true } } } },
      purchaseOrders: { orderBy: { issuedAt: "desc" }, take: 5 },
    },
  });
  if (!supplier) notFound();
  const [totals, anomalyInvoices] = await Promise.all([
    prisma.invoice.aggregate({
      where: { organizationId: tenant.organizationId, supplierId: supplier.id },
      _sum: { amountTtc: true },
      _avg: { amountTtc: true },
      _count: { _all: true },
    }),
    prisma.invoice.count({
      where: { organizationId: tenant.organizationId, supplierId: supplier.id, anomalies: { some: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } } },
    }),
  ]);
  const count = totals._count._all;
  const rate = count === 0 ? 0 : Math.round((anomalyInvoices / count) * 100);
  const latest = supplier.invoices[0];

  return (
    <div>
      <PageHeader eyebrow="Fournisseur" title={supplier.name} description={[supplier.siren && `SIREN ${supplier.siren}`, supplier.vatNumber, supplier.email, supplier.phone, supplier.paymentTerms].filter(Boolean).join(" · ") || "Fiche fournisseur"} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Nombre de factures", String(count)],
          ["Montant total", formatMoney(totals._sum.amountTtc ?? 0)],
          ["Montant moyen", formatMoney(totals._avg.amountTtc ?? 0)],
          ["Factures avec anomalie", String(anomalyInvoices)],
          ["Taux d'anomalie", `${rate} %`],
          ["Dernière facture", latest ? latest.number : "—"],
        ].map(([label, value]) => (
          <Panel key={label} className="px-5 py-4">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-2 text-xl font-semibold">{value}</p>
          </Panel>
        ))}
      </div>
      {supplier.address && <p className="mt-4 text-sm text-muted">{supplier.address}</p>}
      <h2 className="mb-3 mt-8 text-sm font-medium">Factures</h2>
      <ul className="space-y-2 text-sm">
        {supplier.invoices.map((invoice) => (
          <li key={invoice.id}>
            <Link className="font-medium underline" href={`/invoices/${invoice.id}`}>{invoice.number}</Link>
            <span className="text-muted"> · {formatDate(invoice.issuedAt)} · {formatMoney(invoice.amountTtc)} · {invoice._count.anomalies} anomalie(s)</span>
          </li>
        ))}
      </ul>
      <h2 className="mb-3 mt-8 text-sm font-medium">Commandes</h2>
      <ul className="space-y-2 text-sm">
        {supplier.purchaseOrders.map((order) => (
          <li key={order.id}><Link className="underline" href={`/orders/${order.id}`}>{order.number}</Link> · {formatMoney(order.amountTtc)}</li>
        ))}
      </ul>
    </div>
  );
}

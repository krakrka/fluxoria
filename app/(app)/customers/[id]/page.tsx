import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant();
  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id, organizationId: tenant.organizationId },
    include: { invoices: { orderBy: { issuedAt: "desc" }, take: 12, include: { document: { select: { id: true, filename: true } } } } },
  });
  if (!customer) notFound();
  return (
    <div>
      <PageHeader eyebrow="Client" title={customer.name} description={[customer.siren, customer.vatNumber, customer.email].filter(Boolean).join(" · ") || "Fiche client"} />
      {customer.address && <p className="mb-4 text-sm text-muted">{customer.address}</p>}
      <Panel className="p-5">
        <ul className="space-y-2 text-sm">
          {customer.invoices.map((invoice) => (
            <li key={invoice.id}>
              <Link className="font-medium underline" href={`/invoices/${invoice.id}`}>{invoice.number}</Link>
              <span className="text-muted"> · {formatDate(invoice.issuedAt)} · {formatMoney(invoice.amountTtc)}</span>
              {invoice.document && <Link className="ml-2 underline" href={`/documents/${invoice.document.id}`}>{invoice.document.filename}</Link>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

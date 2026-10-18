import Link from "next/link";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { partyAction } from "@/server/actions";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { Field, Input } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const tenant = await requireTenant();
  const customers = await prisma.customer.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });

  return (
    <div>
      <PageHeader eyebrow="Ventes" title="Clients" description="Référentiel des clients de l'organisation." />
      {can(tenant.role, "parties.manage") && (
        <Panel className="mb-6 p-5">
          <StatefulForm action={partyAction} className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="kind" value="customer" />
            <Field label="Nom"><Input name="name" required /></Field>
            <Field label="SIREN"><Input name="siren" /></Field>
            <Field label="Email"><Input name="email" type="email" /></Field>
            <div className="flex items-end"><SubmitButton>Ajouter</SubmitButton></div>
          </StatefulForm>
        </Panel>
      )}
      {customers.length === 0 ? (
        <EmptyState title="Aucun client" body="Les clients sont aussi créés lors de l'extraction d'une facture." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">SIREN</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Factures</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium"><Link className="hover:underline" href={`/customers/${customer.id}`}>{customer.name}</Link></td>
                  <td className="px-4 py-3">{customer.siren ?? "—"}</td>
                  <td className="px-4 py-3">{customer.email ?? "—"}</td>
                  <td className="px-4 py-3">{customer._count.invoices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { partyAction } from "@/server/actions";
import { EmptyState, Field, Input, PageHeader, Panel } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const tenant = await requireTenant();
  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });

  return (
    <div>
      <PageHeader eyebrow="Achats" title="Fournisseurs" description="Référentiel utilisé pour classer et rapprocher les factures." />
      {can(tenant.role, "parties.manage") && (
        <Panel className="mb-6 p-5">
          <StatefulForm action={partyAction} className="grid gap-3 md:grid-cols-5">
            <input type="hidden" name="kind" value="supplier" />
            <Field label="Nom"><Input name="name" required /></Field>
            <Field label="SIREN"><Input name="siren" /></Field>
            <Field label="Catégorie"><Input name="category" /></Field>
            <Field label="Email"><Input name="email" type="email" /></Field>
            <div className="flex items-end"><SubmitButton>Ajouter</SubmitButton></div>
          </StatefulForm>
        </Panel>
      )}
      {suppliers.length === 0 ? (
        <EmptyState title="Aucun fournisseur" body="Les fournisseurs détectés à l'extraction apparaissent ici." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Catégorie</th>
                <th className="px-4 py-3 font-medium">SIREN</th>
                <th className="px-4 py-3 font-medium">Factures</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium"><Link className="hover:underline" href={`/suppliers/${supplier.id}`}>{supplier.name}</Link></td>
                  <td className="px-4 py-3">{supplier.category ?? "—"}</td>
                  <td className="px-4 py-3">{supplier.siren ?? "—"}</td>
                  <td className="px-4 py-3">{supplier._count.invoices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { formatDateTime, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["PENDING", "En attente"],
  ["APPROVED", "Approuvées"],
  ["REJECTED", "Rejetées"],
] as const;

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const tenant = await requireTenant();
  const { status } = await searchParams;
  const selected = FILTERS.some(([value]) => value === status) ? status : "PENDING";
  const approvals = await prisma.approval.findMany({
    where: { organizationId: tenant.organizationId, status: selected as "PENDING" | "APPROVED" | "REJECTED" },
    orderBy: { createdAt: "desc" },
    include: {
      invoice: { include: { supplier: true } },
      requestedBy: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });

  return (
    <div>
      <PageHeader eyebrow="Décisions" title="Approbations" description="Les factures qui dépassent le seuil sûr attendent une personne identifiée." />
      <div className="mb-4 flex gap-2 text-sm">
        {FILTERS.map(([value, label]) => (
          <Link key={value} href={`/approvals?status=${value}`} className={value === selected ? "font-medium underline" : "text-muted"}>
            {label}
          </Link>
        ))}
      </div>
      {approvals.length === 0 ? (
        <EmptyState title={selected === "PENDING" ? "Aucune approbation en attente" : "Aucune approbation"} body="Les demandes apparaîtront ici lorsqu'une règle les créera." />
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Facture</th>
                <th className="px-4 py-3 font-medium">Fournisseur</th>
                <th className="px-4 py-3 font-medium">Montant</th>
                <th className="px-4 py-3 font-medium">Demandeur</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Niveau</th>
                <th className="px-4 py-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={approval.id} className="border-t border-line">
                  <td className="px-4 py-3"><Link className="underline" href={`/approvals/${approval.id}`}>{approval.invoice?.number ?? "—"}</Link></td>
                  <td className="px-4 py-3">{approval.invoice?.supplier?.name ?? "—"}</td>
                  <td className="px-4 py-3">{formatMoney((approval.amountCents / 100).toFixed(2))}</td>
                  <td className="px-4 py-3">{approval.requestedBy?.name ?? "Fluxora"}</td>
                  <td className="px-4 py-3">{formatDateTime(approval.createdAt)}</td>
                  <td className="px-4 py-3">{approval.requiredRole === "OWNER" ? "Propriétaire" : "Manager"}</td>
                  <td className="px-4 py-3">{approval.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

import Link from "next/link";
import { searchOrganization } from "@/services/search";
import { requireTenant } from "@/server/tenant";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { SearchBox } from "@/components/search-box";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const tenant = await requireTenant();
  const { q = "" } = await searchParams;
  const groups = q.trim().length >= 2 ? await searchOrganization(tenant.organizationId, q) : [];

  return (
    <div>
      <PageHeader eyebrow="Recherche" title="Recherche" description="Documents, factures, tiers, commandes, anomalies et approbations de l'organisation active." />
      <SearchBox initial={q} />
      {q.trim().length < 2 ? (
        <div className="mt-6">
          <EmptyState title="Saisissez au moins deux caractères" body="Numéro de facture, fournisseur, client, SIREN, montant, statut ou nom de document." />
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun résultat" body="Rien dans cette organisation ne correspond à cette recherche." />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {groups.map((group) => (
            <Panel key={group.type} className="p-4">
              <h2 className="text-sm font-medium">{group.type}</h2>
              <ul className="mt-2 divide-y divide-line text-sm">
                {group.items.map((item) => (
                  <li key={item.id} className="py-2">
                    <Link className="font-medium underline" href={item.href}>{item.title}</Link>
                    <span className="text-muted"> · {item.detail}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

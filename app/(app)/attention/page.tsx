import Link from "next/link";
import { filterAttention, listAttention } from "@/services/cockpit";
import { requireTenant } from "@/server/tenant";
import { formatEurFromCents } from "@/lib/money";
import { EmptyState, Input, PageHeader, Panel, Select } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AttentionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tenant = await requireTenant();
  const filters = await searchParams;
  const items = filterAttention(await listAttention(tenant.organizationId), filters);

  return (
    <div>
      <PageHeader eyebrow="File" title="À traiter" description="Tout ce qui attend une décision, regroupé par priorité." />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Select name="priority" defaultValue={filters.priority ?? ""} aria-label="Priorité">
          <option value="">Toutes les priorités</option>
          <option value="1">Priorité haute</option>
          <option value="2">Priorité moyenne</option>
          <option value="3">Priorité basse</option>
        </Select>
        <Select name="type" defaultValue={filters.type ?? ""} aria-label="Type">
          <option value="">Tous les types</option>
          <option value="approval">Approbation</option>
          <option value="anomaly">Anomalie</option>
          <option value="invoice">Facture</option>
          <option value="document">Document</option>
        </Select>
        <Input name="status" defaultValue={filters.status ?? ""} placeholder="Statut" aria-label="Statut" />
        <Input name="supplier" defaultValue={filters.supplier ?? ""} placeholder="Fournisseur" aria-label="Fournisseur" />
        <Input name="from" type="date" defaultValue={filters.from ?? ""} aria-label="Depuis le" />
        <Select name="sort" defaultValue={filters.sort ?? "priority"} aria-label="Tri">
          <option value="priority">Tri par priorité</option>
          <option value="date">Tri par date</option>
          <option value="amount">Tri par montant</option>
        </Select>
        <button className="h-10 rounded-lg border border-line px-3 text-sm sm:col-span-2" type="submit">Filtrer</button>
      </form>
      {items.length === 0 ? (
        <EmptyState title="Aucune facture à traiter" body="Aucune approbation en attente, aucune anomalie ouverte, aucun document en erreur." />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Panel key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-muted">{item.detail}{item.supplier ? ` · ${item.supplier}` : ""} · {item.status}</p>
              </div>
              <div className="flex items-center gap-3">
                {item.amountCents !== null && <span>{formatEurFromCents(item.amountCents)}</span>}
                <Link className="underline" href={item.href}>Ouvrir</Link>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

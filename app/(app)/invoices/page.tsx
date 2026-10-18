import Link from "next/link";
import { listInvoices } from "@/services/invoices";
import { requirePermission } from "@/server/tenant";
import { INVOICE_STATUS_LABEL, MATCH_STATUS_LABEL } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, Input, PageHeader, Select, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

type Search = {
  q?: string;
  supplier?: string;
  status?: string;
  currency?: string;
  anomaly?: string;
  from?: string;
  to?: string;
  page?: string;
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const tenant = await requirePermission("invoices.read");
  const query = await searchParams;
  const result = await listInvoices({
    organizationId: tenant.organizationId,
    q: query.q,
    supplier: query.supplier,
    status: query.status,
    currency: query.currency,
    anomaly: query.anomaly,
    from: query.from,
    to: query.to,
    page: Number(query.page ?? "1"),
  });

  return (
    <div>
      <PageHeader eyebrow="Trésorerie" title="Factures" description="Numéro, fournisseur, commande, montant et anomalies ouvertes." />
      <form className="mb-4 grid gap-3 rounded-2xl border border-line bg-card p-4 md:grid-cols-4" action="/invoices">
        <label className="text-sm">Recherche<Input name="q" defaultValue={query.q} placeholder="Numéro, fournisseur, commande" aria-label="Recherche" /></label>
        <label className="text-sm">Fournisseur<Input name="supplier" defaultValue={query.supplier} aria-label="Fournisseur" /></label>
        <label className="text-sm">Statut
          <Select name="status" defaultValue={query.status ?? ""} aria-label="Statut">
            <option value="">Tous</option>
            {Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
        <label className="text-sm">Devise<Input name="currency" defaultValue={query.currency} placeholder="EUR" aria-label="Devise" /></label>
        <label className="text-sm">Du<Input name="from" type="date" defaultValue={query.from} aria-label="Date de début" /></label>
        <label className="text-sm">Au<Input name="to" type="date" defaultValue={query.to} aria-label="Date de fin" /></label>
        <label className="text-sm">Anomalies
          <Select name="anomaly" defaultValue={query.anomaly ?? ""} aria-label="Anomalies">
            <option value="">Toutes</option>
            <option value="open">Avec anomalie ouverte</option>
          </Select>
        </label>
        <div className="flex items-end"><button className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground" type="submit">Filtrer</button></div>
      </form>
      {result.rows.length === 0 ? (
        <EmptyState title="Aucune facture" body="Une facture apparaît ici après le traitement d'un document." href="/documents" action="Déposer un document" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-background text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Numéro</th>
                <th className="px-4 py-3 font-medium">Fournisseur</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Échéance</th>
                <th className="px-4 py-3 font-medium">HT</th>
                <th className="px-4 py-3 font-medium">TVA</th>
                <th className="px-4 py-3 font-medium">TTC</th>
                <th className="px-4 py-3 font-medium">Devise</th>
                <th className="px-4 py-3 font-medium">Commande</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">Anomalies</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((invoice) => (
                <tr key={invoice.id} className="border-t border-line">
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/invoices/${invoice.id}`}>{invoice.number}</Link></td>
                  <td className="px-4 py-3">{invoice.supplier?.name ?? invoice.customer?.name ?? "—"}</td>
                  <td className="px-4 py-3">{formatDate(invoice.issuedAt)}</td>
                  <td className="px-4 py-3">{formatDate(invoice.dueAt)}</td>
                  <td className="px-4 py-3">{formatMoney(invoice.amountHt)}</td>
                  <td className="px-4 py-3">{formatMoney(invoice.amountVat)}</td>
                  <td className="px-4 py-3">{formatMoney(invoice.amountTtc)}</td>
                  <td className="px-4 py-3">{invoice.currency}</td>
                  <td className="px-4 py-3">{invoice.purchaseOrderNumber ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={invoice.status} label={INVOICE_STATUS_LABEL[invoice.status]} /><span className="mt-1 block text-xs text-muted">{MATCH_STATUS_LABEL[invoice.matchStatus]}</span></td>
                  <td className="px-4 py-3">{invoice.anomalies.length > 0 ? invoice.anomalies.length : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-muted">Page {result.page} / {result.pages}</p>
    </div>
  );
}

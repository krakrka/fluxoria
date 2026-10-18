import Link from "next/link";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/tenant";
import { ANOMALY_SEVERITY_LABEL, ANOMALY_STATUS_LABEL, ANOMALY_TYPE_LABEL } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, Input, PageHeader, Select, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

type Search = { status?: string; severity?: string; type?: string; supplier?: string; q?: string; from?: string; to?: string; page?: string };

export default async function AnomaliesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const tenant = await requirePermission("invoices.read");
  const query = await searchParams;
  const page = Math.max(1, Number(query.page ?? "1"));
  const where = {
    organizationId: tenant.organizationId,
    status: query.status ? query.status as "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "IGNORED" : undefined,
    severity: query.severity ? query.severity as "INFO" | "WARNING" | "CRITICAL" : undefined,
    type: query.type ? query.type as keyof typeof ANOMALY_TYPE_LABEL : undefined,
    supplier: query.supplier ? { name: { contains: query.supplier, mode: "insensitive" as const } } : undefined,
    createdAt: query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(`${query.to}T23:59:59`) : undefined } : undefined,
    OR: query.q
      ? [
          { invoice: { number: { contains: query.q, mode: "insensitive" as const } } },
          { invoice: { purchaseOrderNumber: { contains: query.q, mode: "insensitive" as const } } },
          { supplier: { name: { contains: query.q, mode: "insensitive" as const } } },
          { title: { contains: query.q, mode: "insensitive" as const } },
        ]
      : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.anomaly.count({ where }),
    prisma.anomaly.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { supplier: true, invoice: true, document: { select: { filename: true } } },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader eyebrow="Contrôle" title="Anomalies" description="Ce qui demande une décision : écarts, doublons, factures sans commande." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[
          ["", "Toutes"],
          ["OPEN", "Ouvertes"],
          ["CRITICAL", "Critiques"],
          ["WARNING", "Avertissements"],
          ["RESOLVED", "Résolues"],
        ].map(([value, label]) => (
          <Link key={label} className="rounded-full border border-line px-3 py-1" href={value === "CRITICAL" || value === "WARNING" ? `/anomalies?severity=${value}` : value ? `/anomalies?status=${value}` : "/anomalies"}>
            {label}
          </Link>
        ))}
      </div>
      <form className="mb-4 grid gap-3 rounded-2xl border border-line bg-card p-4 md:grid-cols-4" action="/anomalies">
        <label className="text-sm">Recherche<Input name="q" defaultValue={query.q} placeholder="Fournisseur, facture, commande" aria-label="Recherche" /></label>
        <label className="text-sm">Fournisseur<Input name="supplier" defaultValue={query.supplier} aria-label="Fournisseur" /></label>
        <label className="text-sm">Type
          <Select name="type" defaultValue={query.type ?? ""} aria-label="Type">
            <option value="">Tous</option>
            {Object.entries(ANOMALY_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
        <label className="text-sm">Du<Input name="from" type="date" defaultValue={query.from} aria-label="Date de début" /></label>
        <div className="flex items-end"><button className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground" type="submit">Filtrer</button></div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="Aucune anomalie" body="Les écarts détectés après extraction apparaissent ici." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-background text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Sévérité</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Titre</th>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Fournisseur</th>
                <th className="px-4 py-3 font-medium">Montant</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((anomaly) => (
                <tr key={anomaly.id} className="border-t border-line">
                  <td className="px-4 py-3"><StatusBadge status={anomaly.severity} label={ANOMALY_SEVERITY_LABEL[anomaly.severity]} /></td>
                  <td className="px-4 py-3">{ANOMALY_TYPE_LABEL[anomaly.type]}</td>
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/anomalies/${anomaly.id}`}>{anomaly.title}</Link></td>
                  <td className="px-4 py-3">{anomaly.document?.filename ?? anomaly.invoice?.number ?? "—"}</td>
                  <td className="px-4 py-3">{anomaly.supplier?.name ?? "—"}</td>
                  <td className="px-4 py-3">{anomaly.invoice ? formatMoney(anomaly.invoice.amountTtc) : "—"}</td>
                  <td className="px-4 py-3">{formatDate(anomaly.createdAt)}</td>
                  <td className="px-4 py-3">{ANOMALY_STATUS_LABEL[anomaly.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-muted">Page {page} / {pages} · {total} anomalie{total > 1 ? "s" : ""}</p>
    </div>
  );
}

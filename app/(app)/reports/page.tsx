import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { getDashboard } from "@/services/analytics";
import { formatMoney } from "@/lib/format";
import { formatEurFromCents } from "@/lib/money";
import { DOCUMENT_STATUS_LABEL } from "@/lib/labels";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const tenant = await requireTenant();
  const [stats, byKind, paid] = await Promise.all([
    getDashboard(tenant.organizationId),
    prisma.document.groupBy({
      by: ["kind"],
      where: { organizationId: tenant.organizationId },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { organizationId: tenant.organizationId, status: "PAID", direction: "CUSTOMER" },
      _sum: { amountTtc: true },
    }),
  ]);
  const max = Math.max(1, ...byKind.map((row) => row._count._all));

  return (
    <div>
      <PageHeader
        eyebrow="Pilotage"
        title="Rapports"
        description="Volumes, statuts et encaissements. Les économies restent une estimation basée sur une hypothèse de temps."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Panel className="p-5">
          <p className="text-sm text-muted">Documents traités ou validés</p>
          <p className="mt-2 text-2xl font-semibold">{stats.processed}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-sm text-muted">Estimation de temps économisé</p>
          <p className="mt-2 text-2xl font-semibold">{formatEurFromCents(stats.estimatedSavingsCents)}</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-sm text-muted">Factures clients payées</p>
          <p className="mt-2 text-2xl font-semibold">{formatMoney(paid._sum.amountTtc ?? 0)}</p>
        </Panel>
      </div>
      <Panel className="mt-6 p-5">
        <h2 className="text-sm font-medium">Répartition des documents</h2>
        <ul className="mt-4 space-y-3">
          {byKind.map((row) => (
            <li key={row.kind}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{row.kind}</span>
                <span>{row._count._all}</span>
              </div>
              <div className="h-2 rounded-full bg-background">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${(row._count._all / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          À vérifier : {stats.needsReview}. Erreurs : {stats.errors}. Statuts suivis : {Object.values(DOCUMENT_STATUS_LABEL).join(", ")}.
        </p>
      </Panel>
    </div>
  );
}

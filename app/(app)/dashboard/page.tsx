import Link from "next/link";
import { getOnboardingChecklist, getOperationalKpis, listActivity, listAttention } from "@/services/cockpit";
import { requireTenant } from "@/server/tenant";
import { formatDateTime } from "@/lib/format";
import { formatEurFromCents } from "@/lib/money";
import { ROI_DISCLAIMER } from "@/lib/roi";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

function percent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)} %`;
}

export default async function DashboardPage() {
  const tenant = await requireTenant();
  const [items, activity, kpis, onboarding] = await Promise.all([
    listAttention(tenant.organizationId),
    listActivity(tenant.organizationId),
    getOperationalKpis(tenant.organizationId),
    getOnboardingChecklist(tenant.organizationId),
  ]);
  const today = items.slice(0, 8);

  return (
    <div>
      <PageHeader
        eyebrow="Pilotage"
        title="Tableau de bord"
        description="Les actions ouvertes d'abord, puis l'activité et les indicateurs calculés sur les factures de l'organisation."
        action={
          <Link href="/documents" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground">
            Déposer un document
          </Link>
        }
      />
      <Panel className="mb-6 p-5">
        <p className="text-lg font-semibold">Fluxora vous a fait gagner {Math.round(kpis.savedMinutes)} minute{Math.round(kpis.savedMinutes) > 1 ? "s" : ""}.</p>
        <p className="mt-1 text-sm text-muted">{ROI_DISCLAIMER}</p>
      </Panel>
      {!onboarding.complete && (
        <Panel className="mb-6 p-5 text-sm">
          <p className="font-medium">Mise en route</p>
          <ul className="mt-2 space-y-1">
            {onboarding.steps.map((step) => (
              <li key={step.id}>{step.done ? "✓" : "□"} {step.label}</li>
            ))}
          </ul>
          <Link className="mt-3 inline-block underline" href="/onboarding">Continuer l&apos;onboarding</Link>
        </Panel>
      )}
      <h2 className="mb-3 text-sm font-medium">À traiter aujourd&apos;hui</h2>
      <div className="mb-3 flex flex-wrap gap-4 text-sm text-muted">
        <span>Anomalies critiques · {items.filter((item) => item.detail === "Anomalie critique").length}</span>
        <span>Factures sans commande · {items.filter((item) => item.detail === "Facture sans bon de commande").length}</span>
        <span>Documents en erreur · {items.filter((item) => item.id.startsWith("error-")).length}</span>
      </div>
      {today.length === 0 ? (
        <EmptyState title="Aucune facture à traiter" body="Aucune approbation, anomalie critique, erreur ou facture sans commande n'est ouverte." href="/documents" action="Déposer un document" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {today.map((item) => (
            <Link key={item.id} href={item.href} className="rounded-2xl border border-line bg-card px-4 py-3 text-sm hover:bg-background">
              <p className="font-medium">{item.title}</p>
              <p className="text-muted">{item.detail}{item.supplier ? ` · ${item.supplier}` : ""}</p>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-medium">Indicateurs du mois</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ["Factures traitées ce mois", String(kpis.processed)],
            ["Montant traité", formatEurFromCents(kpis.amountCents)],
            ["Taux d'automatisation", percent(kpis.automationRate)],
            ["Taux de validation automatique", percent(kpis.autoValidationRate)],
            ["Documents validés", String(kpis.validatedDocuments)],
            ["Anomalies ouvertes", String(kpis.openAnomalies)],
            ["Temps estimé économisé", `${kpis.savedHours.toFixed(1)} h`],
          ].map(([label, value]) => (
            <Panel key={label} className="px-5 py-4">
              <p className="text-sm text-muted">{label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
            </Panel>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{ROI_DISCLAIMER} {kpis.autoValidated} facture(s) auto-validée(s) × {kpis.savedPerInvoice} min. Hypothèses modifiables sur la page ROI.</p>
      </div>
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-medium">Activité récente</h2>
        {activity.length === 0 ? (
          <EmptyState title="Aucune activité" body="Les réceptions, validations, approbations, anomalies et rejets apparaîtront ici." href="/documents" action="Ouvrir les documents" />
        ) : (
          <Panel>
            <ul className="divide-y divide-line">
              {activity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                  <Link href={entry.href} className="hover:underline">
                    <span className="font-medium">{entry.label}</span>
                    <span className="text-muted"> · {entry.actor}</span>
                  </Link>
                  <span className="text-xs text-muted">{formatDateTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

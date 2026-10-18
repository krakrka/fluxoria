import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { publishStatusAction, resolveStatusAction, retrySystemJobAction } from "@/server/actions";
import { productionReadiness } from "@/lib/readiness";
import { productEventCounts } from "@/services/product-events";
import { canEditStatus, readServiceStatus } from "@/services/status";
import { promoteDueJobs } from "@/services/queue";
import { EmptyState, Field, Input, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const tenant = await requireTenant();
  if (!can(tenant.role, "system.read")) {
    return <EmptyState title="Accès limité" body="Le suivi technique est réservé au propriétaire et à l'admin." />;
  }
  await promoteDueJobs();
  const [failedJobs, activeJobs, failedAutomation, connectorErrors, usage, events, status] = await Promise.all([
    prisma.job.findMany({ where: { organizationId: tenant.organizationId, status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.job.findMany({ where: { organizationId: tenant.organizationId, status: { in: ["RECEIVED", "PROCESSING", "RETRYING"] } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.workflowExecution.findMany({ where: { organizationId: tenant.organizationId, status: "FAILED" }, orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.connectorAccount.findMany({ where: { organizationId: tenant.organizationId, OR: [{ status: "ERROR" }, { lastError: { not: null } }] } }),
    prisma.aiUsage.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { createdAt: "desc" }, take: 200 }),
    productEventCounts(tenant.organizationId),
    readServiceStatus(),
  ]);
  const readiness = productionReadiness();
  const editor = canEditStatus(tenant.email);
  const successes = usage.filter((row) => row.outcome === "success");
  const failures = usage.filter((row) => row.outcome === "failure");
  const tokens = usage.reduce((total, row) => total + row.inputTokens + row.outputTokens, 0);
  const costMicros = usage.reduce((total, row) => total + row.estimatedCostMicros, 0);
  const averageMs = successes.length === 0 ? 0 : Math.round(successes.reduce((total, row) => total + row.durationMs, 0) / successes.length);
  const models = [...new Set(usage.map((row) => row.model))];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Technique" title="Système" description="Jobs, automatisations et connecteurs de cette organisation. Le journal d'erreur reste sur chaque job." />
      <section>
        <h2 className="mb-2 text-sm font-medium">Extraction</h2>
        <Panel className="px-4 py-3 text-sm">
          <p>{successes.length} document(s) extrait(s) · {failures.length} échec(s)</p>
          <p className="text-muted">{tokens} jetons · coût estimé {(costMicros / 1_000_000).toFixed(4)} USD · durée moyenne {averageMs} ms</p>
          <p className="text-muted">Modèles : {models.length > 0 ? models.join(", ") : "aucun appel enregistré"}</p>
        </Panel>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Jobs en échec</h2>
        {failedJobs.length === 0 ? <EmptyState title="Aucun job en échec" body="Les traitements qui ont épuisé leurs essais apparaîtront ici." /> : (
          <div className="space-y-2">
            {failedJobs.map((job) => (
              <Panel key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{job.type}</p>
                  <p className="text-muted">{job.error}</p>
                  <p className="text-xs text-muted">{job.attempts} essai(s) · {formatDateTime(job.createdAt)}</p>
                </div>
                <form action={retrySystemJobAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <SubmitButton variant="secondary">Relancer</SubmitButton>
                </form>
              </Panel>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Jobs en cours</h2>
        {activeJobs.length === 0 ? <EmptyState title="Aucun job en cours" body="Les réceptions, traitements et nouvelles tentatives s'affichent ici." /> : (
          <Panel>
            <ul className="divide-y divide-line text-sm">
              {activeJobs.map((job) => (
                <li key={job.id} className="px-4 py-3">{job.type} · {job.status} · essai {job.attempts}</li>
              ))}
            </ul>
          </Panel>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Automatisations en échec</h2>
        {failedAutomation.length === 0 ? <EmptyState title="Aucune automatisation en échec" body="Les règles qui n'ont pas abouti restent listées ici." /> : (
          <Panel>
            <ul className="divide-y divide-line text-sm">
              {failedAutomation.map((row) => (
                <li key={row.id} className="px-4 py-3">{row.trigger ?? row.id} · {row.error ?? "Erreur"}</li>
              ))}
            </ul>
          </Panel>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Mise en production</h2>
        <Panel>
          <ul className="divide-y divide-line text-sm">
            {readiness.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <p className="font-medium">{item.ok ? "Prêt" : "À configurer"} · {item.label}</p>
                <p className="text-muted">{item.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Mesure produit</h2>
        <Panel className="px-4 py-3 text-sm">
          <ul className="space-y-1">
            {events.map((event) => <li key={event.name}>{event.name} · {event.count}</li>)}
          </ul>
          <p className="mt-3 text-muted">Compteurs de cette organisation. Aucun contenu de facture n&apos;est stocké.</p>
        </Panel>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Statut public</h2>
        {editor ? (
          <Panel className="space-y-4 p-5">
            <StatefulForm action={publishStatusAction} className="space-y-3">
              <Field label="Niveau">
                <Select name="level" defaultValue="degraded">
                  <option value="degraded">Dégradé</option>
                  <option value="outage">Incident</option>
                  <option value="operational">Opérationnel</option>
                </Select>
              </Field>
              <Field label="Titre"><Input name="title" required minLength={3} maxLength={120} /></Field>
              <Field label="Message public"><Textarea name="message" required minLength={10} maxLength={500} /></Field>
              <SubmitButton variant="secondary">Publier</SubmitButton>
            </StatefulForm>
            <ul className="space-y-2 text-sm">
              {status.incidents.filter((incident) => !incident.resolvedAt).map((incident) => (
                <li key={incident.id} className="flex items-center justify-between gap-3">
                  <span>{incident.title}</span>
                  <form action={resolveStatusAction}>
                    <input type="hidden" name="incidentId" value={incident.id} />
                    <SubmitButton variant="ghost">Résoudre</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <EmptyState title="Lecture seule" body="La page /status affiche les incidents. La publication est réservée aux emails listés dans STATUS_EDITOR_EMAILS." />
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Erreurs de connecteurs</h2>
        {connectorErrors.length === 0 ? <EmptyState title="Aucune erreur de connecteur" body="Gmail, Drive et Pennylane signaleront ici un échec de synchronisation." /> : (
          <Panel>
            <ul className="divide-y divide-line text-sm">
              {connectorErrors.map((account) => (
                <li key={account.id} className="px-4 py-3">{account.provider} · {account.lastError}</li>
              ))}
            </ul>
          </Panel>
        )}
      </section>
    </div>
  );
}

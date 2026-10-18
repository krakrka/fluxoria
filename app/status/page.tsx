import { SiteFrame } from "@/components/site-frame";
import { readServiceStatus } from "@/services/status";

const LABEL = {
  operational: "Opérationnel",
  degraded: "Dégradé",
  outage: "Incident",
  unmeasured: "Non mesuré",
} as const;

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const status = await readServiceStatus();
  return (
    <SiteFrame>
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Statut</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{LABEL[status.level]}</h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          Cette page annonce les incidents publiés. Sans incident, le service n&apos;est pas déclaré opérationnel : aucune sonde de base, de stockage ou de fournisseur n&apos;est affichée ici. Elle ne publie ni document, ni facture, ni donnée d&apos;une organisation.
        </p>
        <ul className="mt-8 space-y-3">
          {status.incidents.length === 0 ? (
            <li className="rounded-2xl border border-line bg-card p-5 text-sm">Aucun incident enregistré.</li>
          ) : status.incidents.map((incident) => (
            <li key={incident.id} className="rounded-2xl border border-line bg-card p-5">
              <p className="font-medium">{incident.title}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{incident.message}</p>
              <p className="mt-2 text-xs text-muted">{incident.resolvedAt ? "Résolu" : "Ouvert"} · {incident.level}</p>
            </li>
          ))}
        </ul>
      </section>
    </SiteFrame>
  );
}

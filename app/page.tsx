import Link from "next/link";
import { SiteFrame } from "@/components/site-frame";
import { DEMO_PATH } from "@/lib/demo-story";
import { planCatalog } from "@/lib/plans";

const promises = [
  ["Moins de saisie", "Les champs d'une facture sont proposés. L'équipe corrige ce qui est faible, elle ne retape pas toute la pièce."],
  ["Moins d'erreurs", "Un écart de montant, de fournisseur ou de bon de commande reste visible au lieu de passer dans un tableur."],
  ["Factures traitées", "Chaque facture avance : extraction, rapprochement, règle, puis validation ou approbation."],
  ["Anomalies", "Le doublon, le bon manquant et l'écart de prix deviennent une file à traiter, pas une surprise en fin de mois."],
  ["Approbation", "Le montant décide du circuit : validation seule, manager, ou propriétaire. La règle est expliquée."],
  ["Traçabilité", "Chaque correction et chaque décision garde l'auteur, l'ancienne valeur et la nouvelle."],
];

export default function HomePage() {
  const plans = planCatalog();
  return (
    <SiteFrame>
      <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-16 pt-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Pour les PME</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight">
            L&apos;automatisation administrative intelligente des PME.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
            Fluxora fait avancer les factures, les bons de commande et les validations. Le contrôle humain reste là où la pièce n&apos;est pas sûre.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-accent-foreground">Commencer</Link>
            <Link href="/demo" className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-5 text-sm">Demander une démo</Link>
          </div>
        </div>
        <div className="rounded-3xl border border-line bg-card p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Parcours de démonstration</p>
          <ol className="mt-4 space-y-2 text-sm">
            {DEMO_PATH.map((step, index) => (
              <li key={step.id} className="flex gap-3">
                <span className="text-muted">{index + 1}</span>
                {step.title}
              </li>
            ))}
          </ol>
          <Link href="/demo" className="mt-4 inline-block text-sm underline">Voir le parcours en quelques minutes</Link>
        </div>
      </section>

      <section className="border-y border-line bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-3">
          {promises.map(([title, body]) => (
            <article key={title}>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="tarifs" className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Trois plans</h2>
            <p className="mt-3 max-w-2xl text-sm text-muted">Les prix viennent de la configuration. Le paiement n&apos;est confirmé que par Stripe.</p>
          </div>
          <Link href="/pricing" className="text-sm underline">Voir les limites</Link>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {(Object.keys(plans) as Array<keyof typeof plans>).map((key) => {
            const plan = plans[key];
            return (
              <article key={key} className="rounded-2xl border border-line bg-card p-6">
                <h3 className="text-lg font-semibold">{plan.label}</h3>
                <p className="mt-2 text-2xl font-semibold">{plan.price}</p>
                <p className="mt-3 text-sm text-muted">{plan.documentsPerMonth} documents / mois · {plan.users} utilisateurs</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl bg-foreground px-8 py-12 text-background">
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight">Le premier flux tient en quelques minutes.</h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-background/75">
            Atlas Industrie sert de démonstration : une facture, un bon, une anomalie, une validation automatique et une approbation.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/register" className="inline-flex h-11 items-center rounded-lg bg-card px-5 text-sm font-medium text-foreground">Commencer</Link>
            <Link href="/demo" className="inline-flex h-11 items-center rounded-lg border border-background/30 px-5 text-sm">Demander une démo</Link>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}

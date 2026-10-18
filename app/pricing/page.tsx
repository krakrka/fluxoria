import Link from "next/link";
import { SiteFrame } from "@/components/site-frame";
import { planCatalog } from "@/lib/plans";

function storageLabel(bytes: number) {
  const gigabytes = bytes / 1_073_741_824;
  return gigabytes >= 1 ? `${Math.round(gigabytes)} Go` : `${Math.round(bytes / 1_048_576)} Mo`;
}

export default function PricingPage() {
  const plans = planCatalog();
  return (
    <SiteFrame>
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Tarifs</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Starter, Pro, Business</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
          Les plafonds s&apos;appliquent dans l&apos;application. Un plan payant n&apos;est actif que lorsque Stripe le confirme. Business reste sur devis tant que son prix n&apos;est pas configuré.
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {(Object.keys(plans) as Array<keyof typeof plans>).map((key) => {
            const plan = plans[key];
            return (
              <article key={key} className="flex flex-col rounded-2xl border border-line bg-card p-6">
                <h2 className="text-xl font-semibold">{plan.label}</h2>
                <p className="mt-2 text-3xl font-semibold">{plan.price}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  <li>{plan.documentsPerMonth} documents / mois</li>
                  <li>{plan.invoicesPerMonth} factures / mois</li>
                  <li>{plan.users} utilisateurs</li>
                  <li>{plan.automations} automatisations</li>
                  <li>{storageLabel(plan.storageBytes)} de stockage</li>
                </ul>
                <ul className="mt-5 space-y-2 text-sm text-muted">
                  {plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
                </ul>
                <div className="mt-6 flex flex-col gap-2">
                  <Link href="/register" className="inline-flex h-10 items-center justify-center rounded-lg bg-accent text-sm font-medium text-accent-foreground">Commencer</Link>
                  <Link href="/demo" className="inline-flex h-10 items-center justify-center rounded-lg border border-line text-sm">Demander une démo</Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </SiteFrame>
  );
}

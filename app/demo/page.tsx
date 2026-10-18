import Link from "next/link";
import { SiteFrame } from "@/components/site-frame";
import { DEMO_PATH } from "@/lib/demo-story";
import { demoLoginHint } from "@/lib/runtime-config";

export default function DemoPage() {
  const hint = demoLoginHint();
  return (
    <SiteFrame>
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Démonstration</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">De la facture PDF au journal, en quelques minutes.</h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          Le jeu Atlas Industrie raconte une PME métallurgique : fournisseurs, clients, bons de commande, factures, anomalies, validations automatiques et approbations.
        </p>
        <ol className="mt-8 space-y-4">
          {DEMO_PATH.map((step, index) => (
            <li key={step.id} className="rounded-2xl border border-line bg-card p-5">
              <p className="text-xs text-muted">0{index + 1}</p>
              <h2 className="mt-1 font-semibold">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        {hint && <p className="mt-8 rounded-xl bg-background px-4 py-3 text-sm">{hint}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-accent-foreground">Ouvrir la démonstration</Link>
          <Link href="/register" className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-5 text-sm">Commencer</Link>
        </div>
      </section>
    </SiteFrame>
  );
}

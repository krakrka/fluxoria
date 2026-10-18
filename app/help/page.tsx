import { SiteFrame } from "@/components/site-frame";
import { HELP_ARTICLES } from "@/lib/help";

export default function HelpPage() {
  return (
    <SiteFrame>
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Aide</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Centre d&apos;aide</h1>
        <p className="mt-4 text-sm leading-6 text-muted">Le minimum pour démarrer, traiter une facture et comprendre une limite. Une demande précise se fait dans Support, une fois connecté.</p>
        <nav className="mt-6 flex flex-wrap gap-3 text-sm">
          {HELP_ARTICLES.map((article) => (
            <a key={article.id} href={`#${article.id}`} className="underline">{article.title}</a>
          ))}
        </nav>
        <div className="mt-8 space-y-6">
          {HELP_ARTICLES.map((article) => (
            <article key={article.id} id={article.id} className="rounded-2xl border border-line bg-card p-5">
              <h2 className="font-semibold">{article.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{article.body}</p>
            </article>
          ))}
        </div>
      </section>
    </SiteFrame>
  );
}

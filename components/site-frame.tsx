import Link from "next/link";

export function SiteFrame({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">Fluxora</Link>
        <nav className="flex flex-wrap items-center justify-end gap-4 text-sm">
          <Link href="/demo" className="text-muted">Démonstration</Link>
          <Link href="/pricing" className="text-muted">Tarifs</Link>
          <Link href="/help" className="text-muted">Aide</Link>
          <Link href="/status" className="text-muted">Statut</Link>
          <Link href="/login" className="text-muted">Connexion</Link>
          <Link href="/register" className="rounded-lg bg-accent px-3 py-2 text-accent-foreground">Commencer</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-4 px-6 py-8 text-sm text-muted">
          <Link href="/legal/terms">Conditions</Link>
          <Link href="/legal/privacy">Confidentialité</Link>
          <Link href="/legal/cookies">Cookies</Link>
          <Link href="/legal/security">Sécurité</Link>
          <Link href="/help">Aide</Link>
          <Link href="/status">Statut</Link>
        </div>
      </footer>
    </div>
  );
}

export function LegalPlaceholder() {
  return (
    <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      PLACEHOLDER JURIDIQUE. Ce texte doit être validé par un conseil avant toute utilisation commerciale. Il ne constate aucune conformité.
    </p>
  );
}

import Link from "next/link";
import { Bell, Building2 } from "lucide-react";
import { logoutAction, resendVerificationAction, switchOrganizationAction } from "@/server/actions";
import { ROLE_LABEL } from "@/lib/labels";
import type { MemberRole } from "@/lib/permissions";
import { SideNav } from "@/components/side-nav";
import { StatefulForm } from "@/components/forms";

function VerificationLink() {
  return (
    <StatefulForm action={resendVerificationAction} className="mt-2">
      <button className="font-medium underline" type="submit">
        Préparer le lien de vérification
      </button>
    </StatefulForm>
  );
}

export function Shell({
  organizationId,
  organizationName,
  organizations,
  userName,
  role,
  emailVerified,
  demo,
  trialDaysLeft,
  notifications,
  children,
}: {
  organizationId: string;
  organizationName: string;
  organizations: Array<{ id: string; name: string }>;
  userName: string;
  role: MemberRole;
  emailVerified: boolean;
  demo: boolean;
  trialDaysLeft: number | null;
  notifications: Array<{ id: string; title: string; body: string; href: string | null }>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-card lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground">F</span>
          <div>
            <p className="text-sm font-semibold tracking-tight">Fluxora</p>
            <p className="text-xs text-muted">{demo ? "MODE DÉMO" : "Back-office PME"}</p>
          </div>
        </div>
        <SideNav role={role} />
      </aside>
      <div>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card/80 px-5 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Building2 size={16} className="text-muted" />
            {organizations.length > 1 ? (
              <form action={switchOrganizationAction} className="flex items-center gap-2">
                <select
                  name="organizationId"
                  defaultValue={organizationId}
                  className="h-9 rounded-lg border border-line bg-white px-2 text-sm"
                >
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
                <button className="text-muted hover:text-foreground" type="submit">
                  Ouvrir
                </button>
              </form>
            ) : (
              <span className="font-medium">{organizationName}</span>
            )}
            <span className="text-muted">· {ROLE_LABEL[role]}</span>
            {demo && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">MODE DÉMO</span>}
          </div>
          <form action="/search" className="min-w-0 flex-1 sm:max-w-xs">
            <input name="q" placeholder="Rechercher" aria-label="Recherche globale" className="h-9 w-full rounded-lg border border-line bg-white px-3 text-sm" />
          </form>
          <div className="flex items-center gap-3 text-sm">
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1 text-muted hover:bg-background">
                <Bell size={16} />
                {notifications.length}
              </summary>
              <div className="absolute right-0 z-10 mt-2 w-80 rounded-xl border border-line bg-card p-3 shadow-sm">
                {notifications.length === 0 && <p className="text-sm text-muted">Aucune notification.</p>}
                {notifications.map((item) => (
                  <a key={item.id} href={item.href ?? "/notifications"} className="block rounded-lg px-2 py-2 hover:bg-background">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted">{item.body}</p>
                  </a>
                ))}
                <Link className="mt-2 block text-xs underline" href="/notifications">Ouvrir le centre</Link>
              </div>
            </details>
            <span>{userName}</span>
            <form action={logoutAction}>
              <button className="text-muted hover:text-foreground" type="submit">
                Déconnexion
              </button>
            </form>
          </div>
        </header>
        {trialDaysLeft !== null && (
          <div className="border-b border-line bg-card px-5 py-3 text-sm">
            Essai : {trialDaysLeft} jour{trialDaysLeft > 1 ? "s" : ""} restant{trialDaysLeft > 1 ? "s" : ""}. L'usage et le choix du plan sont dans Facturation.
          </div>
        )}
        {!emailVerified && (
          <div className="border-b border-line bg-amber-50 px-5 py-3 text-sm text-warning">
            Votre email n'est pas encore vérifié. Le compte fonctionne. La vérification confirme qu'il vous appartient.
            <VerificationLink />
          </div>
        )}
        <main className="px-5 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

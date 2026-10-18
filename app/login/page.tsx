import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Field, Input } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { loginAction } from "@/server/actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const params = await searchParams;
  return (
    <AuthCard title="Connexion" subtitle="Accédez à l'espace de votre organisation.">
      {params.reset && <p className="mb-4 text-sm text-accent">Mot de passe mis à jour. Vous pouvez vous connecter.</p>}
      <StatefulForm action={loginAction} className="space-y-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Mot de passe">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton pendingLabel="Connexion…">Se connecter</SubmitButton>
      </StatefulForm>
      <div className="mt-6 space-y-2 text-sm">
        <Link className="block text-accent" href="/forgot-password">
          Mot de passe oublié
        </Link>
        <Link className="block text-muted" href="/register">
          Créer une organisation
        </Link>
      </div>
      {process.env.NODE_ENV !== "production" && (
        <div className="mt-8 rounded-xl border border-line bg-card p-4 text-xs leading-5 text-muted">
          Démonstration Atlas Industrie — mot de passe <span className="font-medium text-foreground">Fluxora-Demo-2026</span>
          <br />
          owner@atlas-industrie.test · admin@atlas-industrie.test · member@atlas-industrie.test · accountant@atlas-industrie.test
        </div>
      )}
    </AuthCard>
  );
}

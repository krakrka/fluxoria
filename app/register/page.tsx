import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Field, Input } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { registerAction } from "@/server/actions";

export default function RegisterPage() {
  return (
    <AuthCard title="Créer votre espace" subtitle="Demander une démonstration commence par créer l'organisation. Aucun paiement n'est demandé.">
      <StatefulForm action={registerAction} className="space-y-4">
        <Field label="Votre nom">
          <Input name="name" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required />
        </Field>
        <Field label="Mot de passe">
          <Input name="password" type="password" required />
        </Field>
        <Field label="Organisation">
          <Input name="organizationName" required />
        </Field>
        <Field label="SIREN (optionnel)">
          <Input name="siren" inputMode="numeric" maxLength={9} />
        </Field>
        <label className="flex items-start gap-2 text-sm leading-5">
          <input className="mt-1" type="checkbox" name="consent" required />
          <span>J'accepte que Fluxora conserve les données de mon organisation pour fournir le service. La durée de conservation est réglable ensuite.</span>
        </label>
        <SubmitButton pendingLabel="Création…">Créer l'organisation</SubmitButton>
      </StatefulForm>
      <Link className="mt-6 block text-sm text-muted" href="/login">
        Déjà un compte
      </Link>
    </AuthCard>
  );
}

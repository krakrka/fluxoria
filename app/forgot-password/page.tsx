import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Field, Input } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { forgotAction } from "@/server/actions";

export default function ForgotPage() {
  return (
    <AuthCard title="Réinitialiser le mot de passe" subtitle="L'email part lorsque la livraison est activée. En développement, le lien s'affiche après la demande.">
      <StatefulForm action={forgotAction} className="space-y-4">
        <Field label="Email">
          <Input name="email" type="email" required />
        </Field>
        <SubmitButton>Préparer le lien</SubmitButton>
      </StatefulForm>
      <Link className="mt-6 block text-sm text-muted" href="/login">
        Retour à la connexion
      </Link>
    </AuthCard>
  );
}

import { AuthCard } from "@/components/auth-card";
import { Field, Input } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { resetAction } from "@/server/actions";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  return (
    <AuthCard title="Nouveau mot de passe" subtitle="10 caractères minimum, avec une lettre et un chiffre.">
      <StatefulForm action={resetAction} className="space-y-4">
        <input type="hidden" name="token" value={params.token ?? ""} />
        <Field label="Nouveau mot de passe">
          <Input name="password" type="password" required />
        </Field>
        <SubmitButton>Mettre à jour</SubmitButton>
      </StatefulForm>
    </AuthCard>
  );
}

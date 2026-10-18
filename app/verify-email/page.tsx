import { AuthCard } from "@/components/auth-card";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { verifyEmailAction } from "@/server/actions";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  return (
    <AuthCard title="Vérifier l'email" subtitle="Ce lien confirme l'adresse du compte. L'email part lorsque la livraison est activée.">
      <StatefulForm action={verifyEmailAction} className="space-y-4">
        <input type="hidden" name="token" value={params.token ?? ""} />
        <SubmitButton>Confirmer l'adresse</SubmitButton>
      </StatefulForm>
    </AuthCard>
  );
}

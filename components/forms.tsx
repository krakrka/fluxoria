"use client";

import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { Button } from "@/components/ui";
import type { ActionState } from "@/server/actions";

export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
  variant = "primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name={name} value={value} variant={variant} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function StatefulForm({
  action,
  children,
  className,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.message && <p role="status" className="text-sm text-accent">{state.message}</p>}
      {state?.resetUrl && (
        <a className="text-sm font-medium text-accent underline" href={state.resetUrl}>
          Ouvrir le lien (démonstration, aucun email envoyé)
        </a>
      )}
    </form>
  );
}

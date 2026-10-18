"use client";

import { resetDemoAction } from "@/server/actions";
import { SubmitButton } from "@/components/forms";

export function ResetDemoButton() {
  return (
    <form
      action={resetDemoAction}
      onSubmit={(event) => {
        if (!window.confirm("Réinitialiser les factures de cette démonstration ?")) event.preventDefault();
      }}
    >
      <SubmitButton variant="danger">Réinitialiser la démonstration</SubmitButton>
    </form>
  );
}

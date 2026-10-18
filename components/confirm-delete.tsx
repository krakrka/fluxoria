"use client";

import { deleteRuleAction } from "@/server/actions";
import { SubmitButton } from "@/components/forms";

export function ConfirmDelete({ ruleId }: { ruleId: string }) {
  return (
    <form
      action={deleteRuleAction}
      onSubmit={(event) => {
        if (!window.confirm("Supprimer cette règle ?")) event.preventDefault();
      }}
    >
      <input type="hidden" name="ruleId" value={ruleId} />
      <SubmitButton variant="danger">Supprimer</SubmitButton>
    </form>
  );
}

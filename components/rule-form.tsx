"use client";

import { useState } from "react";
import { ruleAction } from "@/server/actions";
import { Field, Input, Select } from "@/components/ui";
import { StatefulForm, SubmitButton } from "@/components/forms";

const FIELDS = [
  ["invoice.total", "Montant TTC"],
  ["invoice.matchScore", "Score de rapprochement"],
  ["invoice.anomalyCount", "Nombre d'anomalies"],
  ["invoice.confidence", "Confiance"],
  ["invoice.supplier", "Fournisseur"],
  ["invoice.currency", "Devise"],
  ["invoice.status", "Statut de facture"],
  ["anomaly.severity", "Sévérité de l'anomalie"],
  ["anomaly.type", "Type d'anomalie"],
] as const;

const OPERATORS = [
  ["greater_or_equal", "supérieur ou égal"],
  ["greater_than", "supérieur à"],
  ["less_than", "inférieur à"],
  ["less_or_equal", "inférieur ou égal"],
  ["equals", "égal à"],
  ["not_equals", "différent de"],
  ["contains", "contient"],
  ["is_empty", "est vide"],
  ["is_not_empty", "n'est pas vide"],
] as const;

type Row = { field: string; op: string; value: string };

export function RuleForm() {
  const [conditions, setConditions] = useState<Row[]>([
    { field: "invoice.total", op: "greater_or_equal", value: "1000" },
  ]);

  function update(index: number, patch: Partial<Row>) {
    setConditions((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  return (
    <StatefulForm action={ruleAction} className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Nom"><Input name="name" required placeholder="Montant élevé" /></Field>
        <Field label="Quand">
          <Select name="trigger" defaultValue="invoice.created">
            <option value="invoice.created">Nouvelle facture</option>
            <option value="anomaly.created">Nouvelle anomalie</option>
            <option value="document.validated">Document validé</option>
            <option value="DOCUMENT_PROCESSED">Document traité</option>
            <option value="INVOICE_OVERDUE">Facture échue</option>
          </Select>
        </Field>
        <Field label="Alors">
          <Select name="action" defaultValue="request_approval">
            <option value="auto_validate">Valider automatiquement</option>
            <option value="request_approval">Demander une approbation</option>
            <option value="create_notification">Créer une notification</option>
            <option value="require_review">Demander une validation document</option>
            <option value="set_category">Appliquer une catégorie</option>
            <option value="mark_reconciled">Marquer rapprochée</option>
            <option value="create_reminder_task">Créer une tâche de relance</option>
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Si toutes les conditions sont vraies</p>
        {conditions.map((condition, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Select name="field" aria-label={`Champ ${index + 1}`} value={condition.field} onChange={(event) => update(index, { field: event.target.value })}>
              {FIELDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Select name="op" aria-label={`Opérateur ${index + 1}`} value={condition.op} onChange={(event) => update(index, { op: event.target.value })}>
              {OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Input name="value" aria-label={`Valeur ${index + 1}`} value={condition.value} required onChange={(event) => update(index, { value: event.target.value })} />
            <button
              type="button"
              className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40"
              disabled={conditions.length === 1}
              onClick={() => setConditions((current) => current.filter((_, rowIndex) => rowIndex !== index))}
            >
              Retirer
            </button>
          </div>
        ))}
        <button
          type="button"
          className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40"
          disabled={conditions.length >= 8}
          onClick={() => setConditions((current) => [...current, { field: "invoice.matchScore", op: "less_than", value: "95" }])}
        >
          Ajouter une condition
        </button>
      </div>
      <Field label="Paramètre d'action"><Input name="actionValue" placeholder="MANAGER, OWNER ou texte de notification" /></Field>
      <div><SubmitButton>Créer la règle</SubmitButton></div>
    </StatefulForm>
  );
}

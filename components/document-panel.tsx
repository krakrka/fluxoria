"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CONFIDENCE_BAND_LABEL, CONFIDENCE_DISCLAIMER, confidenceBand, toConfidencePercent, type ConfidenceThresholds } from "@/lib/confidence";
import { REJECT_REASON_LABEL } from "@/lib/labels";
import { deleteDocumentAction, rejectDocumentAction, reprocessDocumentAction, updateFieldAction } from "@/server/actions";
import { FilePreview } from "@/components/file-preview";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { Button, StatusBadge } from "@/components/ui";

type Field = {
  id: string;
  key: string;
  label: string;
  value: string | null;
  confidence: number;
  source: string;
  validated: boolean;
  page?: number | null;
  zone?: string | null;
  sourceText?: string | null;
};

export function DocumentPanel({
  id,
  status,
  statusLabel,
  filename,
  mimeType,
  warnings,
  errorMessage,
  rejectionReason,
  mockMode,
  minutesSaved,
  thresholds,
  canValidate,
  canReject,
  canReprocess,
  canDelete,
  timeline,
  fields,
  lines,
}: {
  id: string;
  status: string;
  statusLabel: string;
  filename: string;
  mimeType: string;
  warnings: string[];
  errorMessage: string | null;
  rejectionReason: string | null;
  mockMode: boolean;
  minutesSaved: number;
  thresholds: ConfidenceThresholds;
  canValidate: boolean;
  canReject: boolean;
  canReprocess: boolean;
  canDelete: boolean;
  timeline: Array<{ id: string; label: string; at: string }>;
  fields: Field[];
  lines: Array<{ description: string; quantity: string; unitPrice: string; vatRate: string; amountHt: string; confidence: number }>;
}) {
  const router = useRouter();
  const weakFields = fields.filter((field) => {
    const percent = toConfidencePercent(field.confidence) ?? 0;
    return !field.value || confidenceBand(percent, thresholds) === "low";
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    if (!confirmReprocess) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmReprocess(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmReprocess]);

  useEffect(() => {
    if (status !== "RECEIVED" && status !== "PROCESSING") return;
    let cancelled = false;
    if (status === "RECEIVED") {
      void fetch(`/api/documents/${id}/process`, { method: "POST" });
    }
    const timer = setInterval(async () => {
      const response = await fetch(`/api/documents/${id}`);
      if (!response.ok || cancelled) return;
      const json = (await response.json()) as { data?: { status?: string } };
      const next = json.data?.status;
      if (next && next !== "RECEIVED" && next !== "PROCESSING") router.refresh();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, router, status]);

  const finished = status === "PROCESSED" || status === "NEEDS_REVIEW" || status === "VALIDATED";

  return (
    <div className="grid min-h-[calc(100vh-8rem)] gap-6 lg:grid-cols-2">
      <section className="overflow-hidden rounded-2xl border border-line bg-stone-200/60 p-3">
        <p className="mb-3 px-1 text-sm text-muted">{filename}</p>
        <FilePreview id={id} filename={filename} mimeType={mimeType} />
      </section>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} label={statusLabel} />
          {(status === "RECEIVED" || status === "PROCESSING") && (
            <ol className="text-sm text-muted">
              <li>✓ Document reçu</li>
              <li>{status === "PROCESSING" ? "✓" : "○"} Type de document identifié</li>
              <li>{status === "PROCESSING" ? "●" : "○"} Extraction des données</li>
              <li>○ Vérification</li>
              <li>○ Terminé</li>
            </ol>
          )}
        </div>
        {mockMode && (
          <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm leading-6 text-muted">
            Mode démonstration : les données sont simulées. Elles ne sont pas lues dans le fichier et ne doivent pas être considérées comme exactes.
          </p>
        )}
        {finished && (
          <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
            Document traité. Estimation : environ {minutesSaved} minutes de saisie manuelle évitées. Ce n&apos;est pas un gain financier garanti.
          </p>
        )}
        {errorMessage && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">
            Nous n&apos;avons pas réussi à traiter ce document. {errorMessage}
          </p>
        )}
        {rejectionReason && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">Rejet : {rejectionReason}</p>}
        {warnings.filter((warning) => !warning.startsWith("Champs à corriger")).map((warning) => (
          <p key={warning} className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-warning">
            Vérification recommandée — {warning}
          </p>
        ))}
        {weakFields.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-warning">
            Champs à corriger : {weakFields.map((field) => field.label).join(", ")}
          </p>
        )}
        <div className="divide-y divide-line rounded-2xl border border-line bg-card">
          {fields.map((field) => {
            const percent = toConfidencePercent(field.confidence) ?? 0;
            const band = confidenceBand(percent, thresholds);
            const low = band === "low";
            return (
              <div key={field.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{field.label}</p>
                  {editing === field.key ? (
                    <StatefulForm action={updateFieldAction} className="mt-2 flex gap-2">
                      <input type="hidden" name="documentId" value={id} />
                      <input type="hidden" name="key" value={field.key} />
                      <input name="value" aria-label={field.label} defaultValue={field.value ?? ""} className="h-10 w-full rounded-lg border border-line px-3 text-sm" />
                      <SubmitButton>Enregistrer</SubmitButton>
                    </StatefulForm>
                  ) : (
                    <p className="mt-1 text-base font-medium">{field.value || "—"}</p>
                  )}
                  <p className={`mt-1 text-xs ${low ? "text-warning" : "text-muted"}`}>
                    {low ? "Vérification recommandée. " : `${CONFIDENCE_BAND_LABEL[band]}. `}
                    Confiance : {percent} %. {CONFIDENCE_DISCLAIMER}
                    {" · "}
                    {field.source === "USER" ? "Corrigé" : "Extraction"}
                  </p>
                  {(field.page || field.zone || field.sourceText) && (
                    <p className="mt-1 text-xs text-muted">
                      Page {field.page ?? "—"} · {field.zone ?? "zone non précisée"}
                      {field.sourceText ? ` · « ${field.sourceText} »` : ""}
                    </p>
                  )}
                </div>
                <Button type="button" variant="secondary" aria-label={`Modifier ${field.label}`} onClick={() => setEditing(editing === field.key ? null : field.key)}>
                  Modifier
                </Button>
              </div>
            );
          })}
        </div>
        {lines.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Ligne</th>
                  <th className="px-4 py-3 font-medium">Qté</th>
                  <th className="px-4 py-3 font-medium">Prix</th>
                  <th className="px-4 py-3 font-medium">TVA</th>
                  <th className="px-4 py-3 font-medium">HT</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.description + line.unitPrice} className="border-t border-line">
                    <td className="px-4 py-3">{line.description}</td>
                    <td className="px-4 py-3">{line.quantity}</td>
                    <td className="px-4 py-3">{line.unitPrice}</td>
                    <td className="px-4 py-3">{line.vatRate} %</td>
                    <td className="px-4 py-3">{line.amountHt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {actionError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{actionError}</p>}
        <div className="flex flex-wrap gap-2">
          {canValidate && (
            <Button
              type="button"
              disabled={validating}
              onClick={async () => {
                setValidating(true);
                setActionError(null);
                const response = await fetch(`/api/documents/${id}/validate`, { method: "POST" });
                const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
                setValidating(false);
                if (!response.ok) {
                  setActionError(json?.error?.message ?? "Validation impossible.");
                  return;
                }
                router.refresh();
              }}
            >
              {validating ? "Validation…" : "Valider le document"}
            </Button>
          )}
          {canReprocess && (
            <Button type="button" variant="secondary" onClick={() => setConfirmReprocess(true)}>
              Réanalyser
            </Button>
          )}
          {canDelete && (
            <form action={deleteDocumentAction} onSubmit={(event) => { if (!window.confirm("Supprimer ce document de votre organisation ?")) event.preventDefault(); }}>
              <input type="hidden" name="documentId" value={id} />
              <SubmitButton variant="danger">Supprimer</SubmitButton>
            </form>
          )}
        </div>
        {confirmReprocess && (
          <div role="dialog" aria-modal="true" aria-labelledby="reprocess-title" className="rounded-2xl border border-line bg-card p-4">
            <h2 id="reprocess-title" className="text-sm font-medium">Réanalyser ce document ?</h2>
            <p className="mt-1 text-sm text-muted">Le résultat actuel est conservé dans l&apos;historique, puis une nouvelle analyse démarre.</p>
            <div className="mt-3 flex gap-2">
              <form action={reprocessDocumentAction}>
                <input type="hidden" name="documentId" value={id} />
                <SubmitButton pendingLabel="Relance…">Confirmer</SubmitButton>
              </form>
              <Button type="button" variant="secondary" onClick={() => setConfirmReprocess(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
        {canReject && (
          <StatefulForm action={rejectDocumentAction} className="space-y-2">
            <input type="hidden" name="documentId" value={id} />
            <label className="block text-sm">
              Motif du rejet
              <select name="code" required className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm" defaultValue="">
                <option value="" disabled>Choisir un motif</option>
                {Object.entries(REJECT_REASON_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <input name="detail" aria-label="Précision du rejet" placeholder="Précision, obligatoire pour Autre" className="h-10 w-full rounded-lg border border-line px-3 text-sm" />
            <SubmitButton variant="danger" pendingLabel="Rejet…">Rejeter</SubmitButton>
          </StatefulForm>
        )}
        <div>
          <h2 className="mb-2 text-sm font-medium">Historique</h2>
          <ol className="space-y-2 text-sm">
            {timeline.map((event) => (
              <li key={event.id} className="rounded-xl border border-line bg-card px-4 py-3">
                <span className="text-muted">{event.at}</span>
                <span className="mt-1 block font-medium">{event.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}

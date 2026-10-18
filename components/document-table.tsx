"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { bulkDocumentsAction } from "@/server/actions";
import { REJECT_REASON_LABEL } from "@/lib/labels";
import { CONFIDENCE_BAND_LABEL, CONFIDENCE_DISCLAIMER, confidenceBand, toConfidencePercent } from "@/lib/confidence";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { StatusBadge } from "@/components/ui";

export type DocumentRow = {
  id: string;
  filename: string;
  typeLabel: string;
  party: string;
  dateLabel: string;
  amountLabel: string;
  status: string;
  statusLabel: string;
  confidence: number | null;
  updatedLabel: string;
  canValidate: boolean;
  canReject: boolean;
  canDelete: boolean;
};

export function DocumentTable({
  rows,
  canDelete,
}: {
  rows: DocumentRow[];
  canDelete: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = rows.filter((row) => selected.includes(row.id));
  const summary = useMemo(
    () => ({
      total: chosen.length,
      validate: chosen.filter((row) => row.canValidate).length,
      reject: chosen.filter((row) => row.canReject).length,
    }),
    [chosen],
  );

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div>
      {summary.total > 0 && (
        <StatefulForm action={bulkDocumentsAction} className="mb-4 rounded-2xl border border-line bg-card p-4 text-sm">
          {selected.map((id) => (
            <input key={id} type="hidden" name="documentId" value={id} />
          ))}
          <p className="font-medium">{summary.total} document{summary.total > 1 ? "s" : ""} sélectionné{summary.total > 1 ? "s" : ""}</p>
          <p className="mt-1 text-muted">
            {summary.validate} peuvent être validés. {summary.total - summary.validate} nécessitent une vérification ou un autre statut.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <SubmitButton name="bulkAction" value="validate">
              Valider la sélection
            </SubmitButton>
            <label className="text-xs text-muted">
              Motif de rejet
              <select name="code" className="mt-1 block h-10 rounded-lg border border-line px-2 text-sm" defaultValue="wrong_document">
                {Object.entries(REJECT_REASON_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton name="bulkAction" value="reject" variant="secondary">
              Rejeter la sélection
            </SubmitButton>
            {canDelete && (
              <SubmitButton name="bulkAction" value="delete" variant="danger">
                Supprimer
              </SubmitButton>
            )}
            <a className="inline-flex h-10 items-center rounded-lg border border-line px-4" href={`/api/documents/export?ids=${selected.join(",")}`}>
              Exporter
            </a>
          </div>
        </StatefulForm>
      )}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-card md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Sélection</span>
              </th>
              <th className="px-4 py-3 font-medium">Document</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Fournisseur / Client</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Montant</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Confiance</th>
              <th className="px-4 py-3 font-medium">Dernière modification</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-4 py-3">
                  <input type="checkbox" aria-label={`Sélectionner ${row.filename}`} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} />
                </td>
                <td className="px-4 py-3">
                  <Link className="font-medium hover:underline" href={`/documents/${row.id}`}>
                    {row.filename}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{row.typeLabel}</td>
                <td className="px-4 py-3">{row.party}</td>
                <td className="px-4 py-3 text-muted">{row.dateLabel}</td>
                <td className="px-4 py-3">{row.amountLabel}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} label={row.statusLabel} />
                </td>
                <td className="px-4 py-3">{confidenceText(row.confidence)}</td>
                <td className="px-4 py-3 text-muted">{row.updatedLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" aria-label={`Sélectionner ${row.filename}`} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} />
              <span>
                <Link className="font-medium hover:underline" href={`/documents/${row.id}`}>
                  {row.filename}
                </Link>
                <span className="mt-1 block text-muted">{row.typeLabel} · {row.party}</span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={row.status} label={row.statusLabel} />
                  <span>{row.amountLabel}</span>
                  <span className="text-muted">{confidenceText(row.confidence)}</span>
                </span>
              </span>
            </label>
          </article>
        ))}
      </div>
    </div>
  );
}

function confidenceText(value: number | null) {
  const percent = toConfidencePercent(value);
  if (percent === null) return "—";
  const band = confidenceBand(percent);
  return `${percent} % · ${CONFIDENCE_BAND_LABEL[band]}. ${CONFIDENCE_DISCLAIMER}`;
}

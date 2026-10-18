"use client";

import { useState } from "react";
import { commitCsvAction } from "@/server/actions";
import { StatefulForm, SubmitButton } from "@/components/forms";
import { Select } from "@/components/ui";

type Preview = { line: number; summary: string; status: "ok" | "error"; message: string };

export function CsvWorkshop() {
  const [kind, setKind] = useState("suppliers");
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    setError(null);
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, csv }),
    });
    const json = (await response.json()) as { data?: { rows: Preview[]; error: string | null }; error?: { message: string } };
    if (!response.ok) {
      setError(json.error?.message ?? "Prévisualisation impossible.");
      return;
    }
    setRows(json.data?.rows ?? []);
    setError(json.data?.error ?? null);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        <label className="text-sm">
          Type
          <Select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Type d'import">
            <option value="suppliers">Fournisseurs</option>
            <option value="customers">Clients</option>
            <option value="orders">Bons de commande</option>
          </Select>
        </label>
        <textarea value={csv} onChange={(event) => setCsv(event.target.value)} aria-label="Contenu CSV" className="min-h-36 rounded-lg border border-line bg-white p-3 font-mono text-xs" />
      </div>
      <button className="h-10 rounded-lg border border-line px-4 text-sm" type="button" onClick={() => void preview()}>
        Prévisualiser
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {rows.length > 0 && (
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.line}>
              Ligne {row.line} · {row.summary} · {row.status === "ok" ? "valide" : row.message}
            </li>
          ))}
        </ul>
      )}
      <StatefulForm action={commitCsvAction} className="space-y-3">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="csv" value={csv} />
        <SubmitButton>Importer les lignes valides</SubmitButton>
      </StatefulForm>
    </div>
  );
}

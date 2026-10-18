"use client";

import { useState } from "react";

export function FilePreview({ id, filename, mimeType }: { id: string; filename: string; mimeType: string }) {
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(1);
  const fileUrl = `/api/documents/${id}/file`;

  if (mimeType.startsWith("image/")) {
    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-lg border border-line bg-card px-3 py-1 text-sm" onClick={() => setZoom((value) => Math.max(50, value - 25))}>
            Zoom arrière
          </button>
          <span className="text-sm text-muted">{zoom} %</span>
          <button type="button" className="rounded-lg border border-line bg-card px-3 py-1 text-sm" onClick={() => setZoom((value) => Math.min(200, value + 25))}>
            Zoom avant
          </button>
          <a className="text-sm font-medium underline" href={`${fileUrl}?download=1`}>
            Télécharger
          </a>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrl} alt={filename} className="max-h-[80vh] w-full object-contain" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-lg border border-line bg-card px-3 py-1 text-sm" onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Page précédente">
          Page précédente
        </button>
        <span className="text-sm text-muted">Page {page}</span>
        <button type="button" className="rounded-lg border border-line bg-card px-3 py-1 text-sm" onClick={() => setPage((value) => Math.min(30, value + 1))} aria-label="Page suivante">
          Page suivante
        </button>
        <button type="button" className="rounded-lg border border-line bg-card px-3 py-1 text-sm" onClick={() => setZoom((value) => Math.max(50, value - 25))}>
          Zoom arrière
        </button>
        <span className="text-sm text-muted">{zoom} %</span>
        <button type="button" className="rounded-lg border border-line bg-card px-3 py-1 text-sm" onClick={() => setZoom((value) => Math.min(200, value + 25))}>
          Zoom avant
        </button>
        <a className="text-sm font-medium underline" href={`${fileUrl}?download=1`}>
          Télécharger
        </a>
      </div>
      <iframe title={filename} src={`${fileUrl}#page=${page}`} className="h-[70vh] w-full bg-white" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left" }} />
    </div>
  );
}

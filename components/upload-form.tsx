"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui";

type Item = {
  name: string;
  progress: number;
  phase: "upload" | "analysis" | "done" | "error";
  id?: string;
  error?: string;
};

const PHASE = {
  upload: ["● Envoi", "○ Analyse", "○ Extraction", "○ Résultat"],
  analysis: ["✓ Uploadé", "● Analyse", "○ Extraction", "○ Résultat"],
  done: ["✓ Uploadé", "✓ Analyse", "✓ Extraction", "✓ Résultat"],
  error: ["✓ Uploadé", "● Analyse", "○ Extraction", "○ Résultat"],
};

export function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function send(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    const next = files.map((file) => ({ name: file.name, progress: 0, phase: "upload" as const }));
    setItems(next);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (file.name.toLowerCase().endsWith(".zip")) {
        await sendZip(file, index, setItems);
        continue;
      }
      try {
        const created = await uploadOne(file, (progress) => {
          setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, progress } : item)));
        });
        setItems((current) =>
          current.map((item, itemIndex) => (itemIndex === index ? { ...item, progress: 100, phase: "analysis", id: created.id } : item)),
        );
        const finalStatus = await waitForResult(created.id);
        setItems((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, phase: finalStatus === "ERROR" ? "error" : "done", error: finalStatus === "ERROR" ? "Le traitement a échoué." : undefined } : item,
          ),
        );
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Envoi impossible.";
        setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, phase: "error", error: message } : item)));
      }
    }
  }

  return (
    <div>
      <form
        className={`rounded-2xl border border-dashed bg-card px-6 py-10 text-center ${over ? "border-accent bg-emerald-50/40" : "border-line"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void send(Array.from(event.dataTransfer.files));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const files = inputRef.current?.files;
          if (files) void send(Array.from(files));
        }}
      >
        <p className="text-base font-medium">Déposez vos documents ici</p>
        <p className="mt-2 text-sm text-muted">PDF, PNG, JPG, JPEG, ou une archive ZIP. Plusieurs fichiers peuvent être déposés ensemble.</p>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          name="files"
          multiple
          aria-label="Fichiers à importer"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg,.zip"
        />
        <div className="mt-4 flex justify-center gap-2">
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
            Parcourir
          </Button>
          <Button type="submit">Importer</Button>
        </div>
      </form>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.name} className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{item.name}</span>
              {item.id && (
                <a className="underline" href={`/documents/${item.id}`}>
                  Ouvrir
                </a>
              )}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-background" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${item.progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">{PHASE[item.phase].join("  ")}</p>
            {item.error && <p className="mt-1 text-xs text-danger">{item.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function sendZip(file: File, index: number, setItems: Dispatch<SetStateAction<Item[]>>) {
  try {
    const result = await uploadBulk(file, (progress) => {
      setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, progress } : item)));
    });
    const rejected = result.rejected.map((item) => `${item.filename} : ${item.error}`).join(" ");
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              progress: 100,
              phase: result.accepted.length === 0 ? "error" : "done",
              error: rejected || undefined,
              id: result.accepted[0]?.id,
            }
          : item,
      ),
    );
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Archive refusée.";
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, phase: "error", error: message } : item)));
  }
}

function uploadBulk(file: File, onProgress: (value: number) => void) {
  return new Promise<{ accepted: Array<{ id: string; filename: string }>; rejected: Array<{ filename: string; error: string }> }>((resolve, reject) => {
    const body = new FormData();
    body.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents/bulk");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const json = JSON.parse(xhr.responseText || "{}") as {
        data?: { accepted: Array<{ id: string; filename: string }>; rejected: Array<{ filename: string; error: string }> };
        error?: { message: string };
      };
      if (xhr.status >= 200 && xhr.status < 300 && json.data) resolve(json.data);
      else reject(new Error(json.error?.message ?? "Envoi impossible."));
    };
    xhr.onerror = () => reject(new Error("Envoi impossible."));
    xhr.send(body);
  });
}

function uploadOne(file: File, onProgress: (value: number) => void) {
  return new Promise<{ id: string }>((resolve, reject) => {
    const body = new FormData();
    body.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const json = JSON.parse(xhr.responseText || "{}") as { data?: Array<{ id: string }>; error?: { message: string } };
      if (xhr.status >= 200 && xhr.status < 300 && json.data?.[0]) resolve(json.data[0]);
      else reject(new Error(json.error?.message ?? "Envoi impossible."));
    };
    xhr.onerror = () => reject(new Error("Envoi impossible."));
    xhr.send(body);
  });
}

async function waitForResult(id: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`/api/documents/${id}`);
    if (response.ok) {
      const json = (await response.json()) as { data?: { status?: string } };
      const status = json.data?.status;
      if (status && status !== "RECEIVED" && status !== "PROCESSING") return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return "PROCESSING";
}

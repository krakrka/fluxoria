import "server-only";
import path from "path";
import { unzip } from "@/lib/zip";
import { createUploadedDocuments } from "@/services/documents";
import { enqueueDocumentProcessing } from "@/services/queue";

const ZIP = new Set([".zip"]);

export async function importBulkDocuments(input: {
  organizationId: string;
  userId: string;
  files: Array<{ filename: string; mimeType: string; bytes: Buffer }>;
}) {
  const accepted: Array<{ id: string; filename: string }> = [];
  const rejected: Array<{ filename: string; error: string }> = [];
  const expanded: Array<{ filename: string; mimeType: string; bytes: Buffer }> = [];
  for (const file of input.files) {
    if (!ZIP.has(path.extname(file.filename).toLowerCase())) {
      expanded.push(file);
      continue;
    }
    try {
      for (const entry of unzip(file.bytes)) {
        expanded.push({ filename: entry.name, mimeType: mimeFor(entry.name), bytes: entry.bytes });
      }
    } catch (error) {
      rejected.push({ filename: file.filename, error: error instanceof Error ? error.message : "Archive illisible." });
    }
  }
  if (expanded.length > 40) {
    return { accepted, rejected: [...rejected, { filename: "lot", error: "40 fichiers maximum par envoi." }] };
  }
  for (const file of expanded) {
    try {
      const created = await createUploadedDocuments({
        organizationId: input.organizationId,
        userId: input.userId,
        files: [file],
      });
      await enqueueDocumentProcessing(input.organizationId, created[0].id);
      accepted.push({ id: created[0].id, filename: created[0].filename });
    } catch (error) {
      rejected.push({ filename: file.filename, error: error instanceof Error ? error.message : "Fichier refusé." });
    }
  }
  return { accepted, rejected };
}

function mimeFor(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

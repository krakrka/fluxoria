import path from "path";

const ALLOWED: Record<string, { extensions: string[]; magic: (bytes: Buffer) => boolean }> = {
  "application/pdf": {
    extensions: [".pdf"],
    magic: (bytes) => bytes.subarray(0, 4).toString("utf8") === "%PDF",
  },
  "image/png": {
    extensions: [".png"],
    magic: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    magic: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  "image/webp": {
    extensions: [".webp"],
    magic: (bytes) => bytes.subarray(0, 4).toString("utf8") === "RIFF" && bytes.subarray(8, 12).toString("utf8") === "WEBP",
  },
};

export function formatUploadLimit(maxBytes: number) {
  const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

export function sanitizeFilename(filename: string) {
  const base = path.basename(filename).replace(/[^\w.\- ()àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ]/g, "_");
  return base.slice(0, 140);
}

export function validateUploadBytes(filename: string, mimeType: string, bytes: Buffer, maxBytes: number) {
  if (!filename || !sanitizeFilename(filename)) {
    throw new Error("Le nom du fichier est vide.");
  }
  if (bytes.byteLength === 0) throw new Error("Le fichier est vide.");
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Ce fichier dépasse la limite de ${formatUploadLimit(maxBytes)} MB.`);
  }
  const rule = ALLOWED[mimeType];
  const extension = path.extname(filename).toLowerCase();
  if (!rule || !rule.extensions.includes(extension) || !rule.magic(bytes)) {
    throw new Error("Format refusé. Envoyez un PDF, PNG, JPG ou JPEG.");
  }
  return sanitizeFilename(filename);
}

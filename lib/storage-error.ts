export class StorageError extends Error {
  readonly code: "invalid_key" | "not_found" | "unavailable";

  constructor(message: string, code: "invalid_key" | "not_found" | "unavailable") {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export function assertObjectKey(key: string) {
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    throw new StorageError("Clé de stockage invalide.", "invalid_key");
  }
}

export function storageDownloadStatus(error: StorageError) {
  if (error.code === "unavailable") return { status: 503, code: "STORAGE", message: "Stockage indisponible." };
  if (error.code === "not_found") return { status: 404, code: "BAD_REQUEST", message: "Fichier introuvable." };
  return { status: 400, code: "BAD_REQUEST", message: "Clé de stockage invalide." };
}

export function assertTenantStorageKey(key: string, organizationId: string) {
  assertObjectKey(key);
  if (!organizationId || organizationId.includes("/") || organizationId.includes("..") || organizationId.includes("\\")) {
    throw new StorageError("Clé de stockage invalide.", "invalid_key");
  }
  if (!key.startsWith(`organizations/${organizationId}/`)) {
    throw new StorageError("Fichier introuvable.", "not_found");
  }
}

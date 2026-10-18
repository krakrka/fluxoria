import "server-only";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { getEnv } from "@/lib/env";
import { assertObjectKey, assertTenantStorageKey, StorageError } from "@/lib/storage-error";
import { validateUploadBytes } from "@/lib/upload-validation";
import { createS3Client } from "@/services/s3";

export interface StorageProvider {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

function assertSafeKey(root: string, key: string) {
  assertObjectKey(key);
  if (path.isAbsolute(key)) throw new StorageError("Clé de stockage invalide.", "invalid_key");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, key);
  if (!target.startsWith(resolvedRoot + path.sep)) {
    throw new StorageError("Clé de stockage invalide.", "invalid_key");
  }
  return target;
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer) {
    const target = assertSafeKey(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string) {
    try {
      return await readFile(assertSafeKey(this.root, key));
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageError("Fichier introuvable.", "not_found");
      throw new StorageError("Stockage indisponible.", "unavailable");
    }
  }

  async delete(key: string) {
    await rm(assertSafeKey(this.root, key), { force: true });
  }

  async getSignedUrl(): Promise<string> {
    throw new Error("Le stockage local ne signe pas d'URL. Le fichier passe par une route authentifiée.");
  }
}

export { assertTenantStorageKey };

/** Production adapter. Documents stay under organizations/{organizationId}/. Variables alone do not prove a live bucket. */
export class S3StorageProvider implements StorageProvider {
  private client() {
    const env = getEnv();
    if (!env.S3_BUCKET || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error("Stockage production non configuré.");
    }
    return createS3Client({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }

  async put(key: string, body: Buffer) {
    assertObjectKey(key);
    await this.client().put(key, body);
  }

  async get(key: string) {
    assertObjectKey(key);
    return this.client().get(key);
  }

  async delete(key: string) {
    assertObjectKey(key);
    await this.client().delete(key);
  }

  async getSignedUrl(): Promise<string> {
    throw new Error("Le fichier passe par une route authentifiée.");
  }
}

export function getStorage(): StorageProvider {
  const env = getEnv();
  if (env.STORAGE_DRIVER === "s3") return new S3StorageProvider();
  return new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
}

export async function reconcileLocalUnreferenced(
  root: string,
  organizationId: string,
  isReferenced: (key: string) => Promise<boolean>,
) {
  if (!/^[a-z0-9]+$/i.test(organizationId)) throw new Error("Organisation introuvable.");
  const base = path.resolve(root);
  const dir = path.resolve(base, "organizations", organizationId, "documents");
  if (!dir.startsWith(base + path.sep)) throw new Error("Clé de stockage invalide.");
  const removed: string[] = [];
  let files: string[] = [];
  try {
    files = await collectFiles(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return removed;
    throw error;
  }
  for (const file of files) {
    const key = path.relative(base, file).split(path.sep).join("/");
    if (!key.startsWith(`organizations/${organizationId}/documents/`)) continue;
    if (await isReferenced(key)) continue;
    await rm(file, { force: true });
    removed.push(key);
  }
  return removed;
}

async function collectFiles(dir: string) {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    const info = await lstat(target);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) found.push(...(await collectFiles(target)));
    else if (info.isFile()) found.push(target);
  }
  return found;
}

export async function readForOrganization(storage: StorageProvider, organizationId: string, key: string) {
  assertTenantStorageKey(key, organizationId);
  return storage.get(key);
}

export { sanitizeFilename } from "@/lib/upload-validation";

export function validateUpload(filename: string, mimeType: string, bytes: Buffer) {
  return validateUploadBytes(filename, mimeType, bytes, getEnv().MAX_UPLOAD_BYTES);
}

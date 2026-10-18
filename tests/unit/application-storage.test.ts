import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { StorageError, storageDownloadStatus } from "@/lib/storage-error";
import { LocalStorageProvider, readForOrganization, type StorageProvider } from "@/services/storage";

const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const organizationId = "org-application-test";
const documentId = "doc-application-test";
const key = `organizations/${organizationId}/documents/${documentId}/original`;
const neighbor = `organizations/${organizationId}/documents/neighbor/original`;
const body = Buffer.from("%PDF-1.4\nfluxora-application-storage-test\n%%EOF");
const neighborBody = Buffer.from("objet-voisin-a-conserver");

describe("application storage path", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("uploads, downloads the same bytes, refuses another organization, and deletes only the test object", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fluxora-app-storage-"));
    const storage = new LocalStorageProvider(root);
    await storage.put(key, body);
    await storage.put(neighbor, neighborBody);

    const downloaded = await readForOrganization(storage, organizationId, key);
    expect(downloaded.equals(body)).toBe(true);

    await expect(readForOrganization(storage, "autre-organisation", key)).rejects.toThrow(/^Fichier introuvable\.$/);
    expect((await storage.get(key)).equals(body)).toBe(true);
    expect((await storage.get(neighbor)).equals(neighborBody)).toBe(true);

    let called = false;
    const guarded: StorageProvider = {
      async put() {
        called = true;
      },
      async get() {
        called = true;
        return Buffer.alloc(0);
      },
      async delete() {
        called = true;
      },
      async getSignedUrl() {
        return "";
      },
    };
    const foreignKey = `organizations/autre-organisation/documents/${documentId}/original`;
    await expect(readForOrganization(guarded, organizationId, foreignKey)).rejects.toThrow(/^Fichier introuvable\.$/);
    expect(called).toBe(false);

    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow(/introuvable/);
    expect((await storage.get(neighbor)).equals(neighborBody)).toBe(true);
  });

  it("reports provider unavailability with a fixed message and leaves the neighboring object", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fluxora-app-storage-"));
    const storage = new LocalStorageProvider(root);
    await storage.put(neighbor, neighborBody);
    const failing: StorageProvider = {
      async put() {
        throw new StorageError(`put ${secret}`, "unavailable");
      },
      async get() {
        throw new StorageError(`<Message>${secret}</Message>`, "unavailable");
      },
      async delete() {
        throw new StorageError(`delete ${secret}`, "unavailable");
      },
      async getSignedUrl() {
        return secret;
      },
    };

    await storage.put(key, body);
    await expect(readForOrganization(failing, organizationId, key)).rejects.toMatchObject({ code: "unavailable" });
    const failure = storageDownloadStatus(new StorageError(`<Message>${secret}</Message>`, "unavailable"));
    expect(failure).toEqual({ status: 503, code: "STORAGE", message: "Stockage indisponible." });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(storageDownloadStatus(new StorageError("Fichier introuvable.", "not_found"))).toEqual({
      status: 404,
      code: "BAD_REQUEST",
      message: "Fichier introuvable.",
    });
    await expect(failing.delete(key)).rejects.toThrow(StorageError);
    expect((await storage.get(key)).equals(body)).toBe(true);
    expect((await storage.get(neighbor)).equals(neighborBody)).toBe(true);
  });
});

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { productionReadiness } from "@/lib/readiness";
import { createS3Client } from "@/services/s3";
import { LocalStorageProvider, readForOrganization, type StorageProvider } from "@/services/storage";

const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const key = "organizations/org-a/documents/doc/original";

describe("local document storage", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("stores, reads and removes a file inside the organization prefix", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fluxora-storage-"));
    const storage = new LocalStorageProvider(root);
    const body = Buffer.from("facture-locale");
    await storage.put(key, body);
    await expect(readForOrganization(storage, "org-a", key)).resolves.toEqual(body);
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow(/introuvable/);
  });

  it("refuses a missing file, a malformed key and another organization", async () => {
    root = await mkdtemp(path.join(tmpdir(), "fluxora-storage-"));
    const storage = new LocalStorageProvider(root);
    await storage.put(key, Buffer.from("only-org-a"));
    await expect(storage.get("organizations/org-a/documents/missing/original")).rejects.toThrow(/introuvable/);
    await expect(storage.get("../organizations/org-a/documents/doc/original")).rejects.toThrow(/invalide/);
    const blocked: StorageProvider = {
      async put() {},
      async get() {
        throw new Error(secret);
      },
      async delete() {},
      async getSignedUrl() {
        return "";
      },
    };
    await expect(readForOrganization(blocked, "org-b", key)).rejects.toThrow(/introuvable/);
    await expect(readForOrganization(storage, "org-b", key)).rejects.toThrow(/introuvable/);
    await expect(readForOrganization(storage, "org-a", key)).resolves.toEqual(Buffer.from("only-org-a"));
  });
});

describe("s3 client without a live bucket", () => {
  const target = {
    bucket: "fluxora-documents",
    region: "eu-west-3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: secret,
  };

  it("puts and reads through the injected client", async () => {
    const objects = new Map<string, Buffer>();
    const client = createS3Client(target, async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        const body = init?.body instanceof Uint8Array ? Buffer.from(init.body) : Buffer.alloc(0);
        objects.set(url, body);
        return new Response(null, { status: 200 });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      const found = objects.get(url);
      if (!found) return new Response(null, { status: 404 });
      return new Response(new Blob([new Uint8Array(found)]), { status: 200 });
    });
    await client.put(key, Buffer.from("pdf"));
    await expect(client.get(key)).resolves.toEqual(Buffer.from("pdf"));
  });

  it("reports a missing object, a bad key and a provider failure without the secret", async () => {
    let calls = 0;
    const client = createS3Client(target, async (url, init) => {
      calls += 1;
      if (init?.method === "GET" && url.includes("/absent/")) return new Response(null, { status: 404 });
      if (init?.method === "GET") return new Response(`<Message>${secret}</Message>`, { status: 500 });
      return new Response(null, { status: 404 });
    });
    await expect(client.put("../secret", Buffer.from("x"))).rejects.toThrow(/invalide/);
    expect(calls).toBe(0);
    await expect(client.get("organizations/org-a/documents/absent/original")).rejects.toThrow(/^Fichier introuvable\.$/);
    await expect(client.get(key)).rejects.toThrow(/^Stockage indisponible\.$/);
    try {
      await client.get(key);
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(secret);
    }
    const unfinished = createS3Client(target, async () => new Response(`<Message>${secret}</Message>`, { status: 202 }));
    await expect(unfinished.delete(key)).rejects.toThrow(/^Stockage indisponible\.$/);
    try {
      await unfinished.delete(key);
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(secret);
    }
  });

  it("hides network failures and does not call storage for a foreign key", async () => {
    const client = createS3Client(target, async () => {
      throw new Error(`connect failed ${secret}`);
    });
    await expect(client.get(key)).rejects.toThrow(/^Stockage indisponible\.$/);
    const storage: StorageProvider = {
      async put() {},
      async get(objectKey) {
        return client.get(objectKey);
      },
      async delete() {},
      async getSignedUrl() {
        return "";
      },
    };
    await expect(readForOrganization(storage, "org-b", key)).rejects.toThrow(/introuvable/);
  });
});

describe("storage readiness", () => {
  it("keeps object storage unchecked until a real bucket is exercised", () => {
    const item = productionReadiness().find((entry) => entry.id === "storage");
    expect(item?.ok).toBe(false);
    expect(item?.detail).toContain("Aucun bucket réel n'a été testé.");
  });
});

import { createHash } from "crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { describe, expect, it, vi } from "vitest";
import { assertIsolatedRestore, backupFailurePayload, databaseName } from "@/lib/backup-plan";
import { beginProbeRecovery, createFileProbeJournal, evaluateProbeConfig, formatProbeFailure, formatProbeReport, journalConfirmsProbe, openProbeClient, probeKeyFromId, ProbeFailure, readProbeJournal, recoverStoredProbe, runStorageProbe, type ObjectStore, type ProbeEnv, type ProbeJournal, type ProbeState } from "@/lib/s3-live-check";
import { StorageError } from "@/lib/storage-error";

const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

function allowed(overrides: ProbeEnv = {}): ProbeEnv {
  return {
    NODE_ENV: "development",
    S3_BUCKET: "fluxora-documents",
    S3_ACCESS_KEY_ID: "AKIAAPPKEYEXAMPLE1",
    S3_SECRET_ACCESS_KEY: "app-secret-value",
    S3_LIVE_CHECK: "true",
    S3_LIVE_CONFIRM: "isolated",
    S3_LIVE_BUCKET: "fluxora-probe",
    S3_LIVE_REGION: "eu-west-3",
    S3_LIVE_ACCESS_KEY_ID: "AKIAPROBEKEYEXAMPL",
    S3_LIVE_SECRET_ACCESS_KEY: secret,
    ...overrides,
  };
}

function memoryClient() {
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  const calls: string[] = [];
  const client: ObjectStore = {
    async put(key, body) {
      calls.push(`put ${key}`);
      objects.set(key, Buffer.from(body));
    },
    async get(key) {
      calls.push(`get ${key}`);
      const found = objects.get(key);
      if (!found) throw new StorageError("Fichier introuvable.", "not_found");
      return Buffer.from(found);
    },
    async delete(key) {
      calls.push(`delete ${key}`);
      deleted.push(key);
      objects.delete(key);
    },
  };
  return { client, objects, deleted, calls };
}

describe("s3 probe guard", () => {
  it("refuses a missing or wrong flag before any client exists", () => {
    const connect = vi.fn();
    for (const enabled of [undefined, "", "1", "TRUE"]) {
      const opened = openProbeClient(allowed({ S3_LIVE_CHECK: enabled }), connect);
      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.reason).toMatch(/S3_LIVE_CHECK/);
    }
    const missing = openProbeClient(allowed({ S3_LIVE_SECRET_ACCESS_KEY: "" }), connect);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/incomplète/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses an incomplete, identical, production or inconsistent configuration", () => {
    expect(evaluateProbeConfig(allowed({ S3_LIVE_REGION: " " })).ok).toBe(false);
    expect(evaluateProbeConfig(allowed({ S3_LIVE_ACCESS_KEY_ID: "" })).ok).toBe(false);
    expect(evaluateProbeConfig(allowed({ S3_LIVE_CONFIRM: "yes" })).ok).toBe(false);
    const sameBucket = evaluateProbeConfig(allowed({ S3_LIVE_BUCKET: "fluxora-documents" }));
    expect(sameBucket.ok).toBe(false);
    if (!sameBucket.ok) expect(sameBucket.reason).toMatch(/identique à S3_BUCKET/);
    const production = evaluateProbeConfig(allowed({ NODE_ENV: "production" }));
    expect(production.ok).toBe(false);
    if (!production.ok) expect(production.reason).toMatch(/production/);
    const sameKey = evaluateProbeConfig(allowed({ S3_LIVE_ACCESS_KEY_ID: "AKIAAPPKEYEXAMPLE1" }));
    expect(sameKey.ok).toBe(false);
    if (!sameKey.ok) expect(sameKey.reason).toMatch(/identifiants/);
    const endpoint = evaluateProbeConfig(allowed({ S3_LIVE_ENDPOINT: "not a url" }));
    expect(endpoint.ok).toBe(false);
    if (!endpoint.ok) expect(endpoint.reason).toMatch(/incohérent/);
    const sameSecret = evaluateProbeConfig(allowed({ S3_LIVE_SECRET_ACCESS_KEY: "app-secret-value" }));
    expect(sameSecret.ok).toBe(false);
    if (!sameSecret.ok) expect(sameSecret.reason).not.toContain("app-secret-value");
    const leaked = evaluateProbeConfig(allowed({ S3_LIVE_CONFIRM: "maybe" }));
    expect(JSON.stringify(leaked)).not.toContain(secret);
    const connect = vi.fn();
    expect(openProbeClient(allowed({ NODE_ENV: "production" }), connect).ok).toBe(false);
    expect(openProbeClient(allowed({ S3_LIVE_BUCKET: "fluxora-documents" }), connect).ok).toBe(false);
    expect(openProbeClient(allowed({ S3_LIVE_ENDPOINT: "ftp://files.example" }), connect).ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it("fails closed when the application bucket, identity or endpoint cannot be compared", () => {
    const connect = vi.fn();
    const missingBucket = evaluateProbeConfig(allowed({ S3_BUCKET: " " }));
    expect(missingBucket.ok).toBe(false);
    if (!missingBucket.ok) {
      expect(missingBucket.reason).toMatch(/S3_BUCKET est absent/);
      expect(missingBucket.reason).not.toContain("fluxora-probe");
    }
    const sameCase = evaluateProbeConfig(allowed({ S3_BUCKET: "Fluxora-Probe", S3_LIVE_BUCKET: "fluxora-probe" }));
    expect(sameCase.ok).toBe(false);
    const missingKey = openProbeClient(allowed({ S3_ACCESS_KEY_ID: "" }), connect);
    const missingSecret = openProbeClient(allowed({ S3_SECRET_ACCESS_KEY: " " }), connect);
    expect(missingKey.ok).toBe(false);
    expect(missingSecret.ok).toBe(false);
    if (!missingSecret.ok) expect(missingSecret.reason).not.toContain(secret);
    const appEndpoint = "https://storage.example";
    expect(evaluateProbeConfig(allowed({ S3_ENDPOINT: appEndpoint })).ok).toBe(false);
    const sameOrigin = evaluateProbeConfig(allowed({ S3_ENDPOINT: appEndpoint, S3_LIVE_ENDPOINT: `${appEndpoint}/probe` }));
    expect(sameOrigin.ok).toBe(false);
    if (!sameOrigin.ok) expect(sameOrigin.reason).toMatch(/même origine/);
    const aimed = evaluateProbeConfig(allowed({ S3_LIVE_ENDPOINT: "https://fluxora-documents.s3.eu-west-3.amazonaws.com" }));
    expect(aimed.ok).toBe(false);
    if (!aimed.ok) expect(aimed.reason).toMatch(/vise le bucket applicatif/);
    const embedded = evaluateProbeConfig(allowed({ S3_LIVE_ENDPOINT: "https://user:secret@files.example" }));
    expect(embedded.ok).toBe(false);
    if (!embedded.ok) expect(embedded.reason).not.toContain("secret");
    const region = evaluateProbeConfig(allowed({ S3_LIVE_REGION: "eu-west-3.example" }));
    expect(region.ok).toBe(false);
    const distinct = evaluateProbeConfig(allowed({ S3_ENDPOINT: appEndpoint, S3_LIVE_ENDPOINT: "https://probe.example" }));
    expect(distinct.ok).toBe(true);
    if (distinct.ok) expect(distinct.target.endpoint).toBe("https://probe.example");
    expect(connect).not.toHaveBeenCalled();
  });

  it("accepts a dedicated probe target without using the bucket name as proof", () => {
    const decision = evaluateProbeConfig(allowed({ S3_LIVE_BUCKET: "prod-looking-name" }));
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.target.bucket).toBe("prod-looking-name");
      expect(decision.target.accessKeyId).toBe("AKIAPROBEKEYEXAMPL");
      expect(decision.target.secretAccessKey).toBe(secret);
    }
  });
});

describe("s3 probe object lifecycle", () => {
  it("writes one key, checks the digest and the missing object, and deletes only that key", async () => {
    const store = memoryClient();
    const first = await runStorageProbe(store.client);
    const second = await runStorageProbe(store.client);
    const report = first;
    const id = report.key.split("/")[3];
    expect(report.sha256).toBe(createHash("sha256").update(`fluxora-storage-probe ${id}\n`).digest("hex"));
    expect(second.key).not.toBe(report.key);
    expect(report.key).toMatch(/^organizations\/s3-live-check\/probes\/[a-f0-9]{16}\/probe\.txt$/);
    expect(store.deleted).toEqual([report.key, second.key]);
    expect(store.calls.filter((call) => call.startsWith("delete "))).toEqual([`delete ${report.key}`, `delete ${second.key}`]);
    expect(store.deleted.some((key) => key.endsWith("/absent.txt"))).toBe(false);
    expect(store.calls.some((call) => call.includes("absent.txt"))).toBe(true);
    expect(store.calls.some((call) => call.includes("autre-organisation"))).toBe(false);
    expect(store.objects.size).toBe(0);
    expect(report.state).toBe("suppression réussie");
    expect(report.issues).toEqual([]);
    expect(probeKeyFromId(report.id)).toBe(report.key);
    expect(report.residual).toBe(false);
    expect(report.local).toEqual(["foreign-key"]);
    expect(report.simulated).toEqual(["provider-unavailable"]);
    expect(report.notRun).toContain("prefix-delete");
    const lines = formatProbeReport(report).join("\n");
    expect(lines).toContain("Simulé, client factice");
    expect(lines).toContain("Local, sans appel réseau");
    expect(lines).not.toContain(secret);
  });

  it("reports a residual object when delete fails and does not leak the provider error", async () => {
    const store = memoryClient();
    const neighbor = "organizations/org-application-test/documents/neighbor/original";
    store.objects.set(neighbor, Buffer.from("objet-voisin"));
    store.client.delete = async (key) => {
      store.deleted.push(key);
      throw new Error(`AKIAIOSFODNN7EXAMPLE ${secret} Signature=abc`);
    };
    const report = await runStorageProbe(store.client);
    expect(store.deleted).toEqual([report.key]);
    expect(store.objects.has(report.key)).toBe(true);
    expect(store.objects.has(neighbor)).toBe(true);
    expect(report.state).toBe("suppression échouée");
    expect(report.residual).toBe(true);
    expect(report.deleteError).toMatch(/peut rester/);
    expect(report.deleteError).not.toContain(secret);
    expect(report.deleteError).not.toContain("AKIA");
    const failureLines = formatProbeReport(report).join("\n");
    expect(failureLines).toContain("peut rester");
    expect(failureLines).not.toContain("accepté");
    expect(failureLines).not.toContain(secret);
  });

  it("hides a provider secret when the upload fails and deletes only the probe key", async () => {
    const deleted: string[] = [];
    const states: ProbeState[] = [];
    const client: ObjectStore = {
      async put() {
        throw new Error(`connect ${secret}`);
      },
      async get() {
        throw new Error("should not read");
      },
      async delete(key) {
        deleted.push(key);
        throw new Error(`delete ${secret}`);
      },
    };
    const failure = await runStorageProbe(client, { journal: { record(trace) { states.push(trace.state); } } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProbeFailure);
    if (!(failure instanceof ProbeFailure)) throw new Error("échec attendu");
    expect(failure.message).toBe("Stockage indisponible.");
    expect(failure.state).toBe("suppression échouée");
    expect(failure.issues).toEqual(["dépôt", "suppression"]);
    expect(failure.residual).toBe(true);
    expect(failure.key).toBe(probeKeyFromId(failure.id));
    expect(deleted).toEqual([failure.key]);
    expect(states[0]).toBe("non démarré");
    expect(states).toContain("dépôt potentiellement effectué");
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(formatProbeFailure(failure).join("\n")).not.toContain("accepté");
  });

  it("records the key before any client call and keeps it when later steps fail", async () => {
    const states: ProbeState[] = [];
    const journal = { record(trace: { state: ProbeState }) { states.push(trace.state); } };
    const store = memoryClient();
    const neighbor = "organizations/org-application-test/documents/neighbor/original";
    store.objects.set(neighbor, Buffer.from("objet-voisin"));
    const put = store.client.put.bind(store.client);
    store.client.put = async (key, body) => {
      expect(states).toEqual(["non démarré", "dépôt potentiellement effectué"]);
      await put(key, body);
    };
    const report = await runStorageProbe(store.client, { journal });
    expect(report.state).toBe("suppression réussie");
    expect(states).toEqual(["non démarré", "dépôt potentiellement effectué", "dépôt effectué", "lecture vérifiée", "suppression réussie"]);
    expect(store.objects.has(neighbor)).toBe(true);
    expect(store.deleted).toEqual([report.key]);

    const reading = memoryClient();
    reading.objects.set(neighbor, Buffer.from("objet-voisin"));
    reading.client.get = async (key) => {
      reading.calls.push(`get ${key}`);
      if (key.endsWith("/probe.txt")) throw new StorageError(`lecture ${secret}`, "unavailable");
      throw new StorageError("Fichier introuvable.", "not_found");
    };
    const readFailure = await runStorageProbe(reading.client).catch((error: unknown) => error);
    expect(readFailure).toBeInstanceOf(ProbeFailure);
    if (!(readFailure instanceof ProbeFailure)) return;
    expect(readFailure.message).toBe("Stockage indisponible.");
    expect(readFailure.state).toBe("suppression réussie");
    expect(readFailure.key).toBe(probeKeyFromId(readFailure.id));
    expect(readFailure.issues).toEqual(["lecture"]);
    expect(JSON.stringify(readFailure)).not.toContain(secret);
    expect(reading.deleted).toEqual([readFailure.key]);
    expect(reading.objects.has(neighbor)).toBe(true);

    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-journal-"));
    try {
      const fileJournal = createFileProbeJournal(directory);
      const failed = memoryClient();
      failed.client.put = async () => {
        throw new Error(`put ${secret} fluxora-storage-probe`);
      };
      await expect(runStorageProbe(failed.client, { journal: fileJournal })).rejects.toMatchObject({ state: "suppression réussie", issues: ["dépôt"] });
      const failure = await runStorageProbe(failed.client, { journal: fileJournal }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ProbeFailure);
      if (!(failure instanceof ProbeFailure)) throw new Error("échec attendu");
      const stored = JSON.parse(await readFile(path.join(directory, `${failure.id}.json`), "utf8")) as { id: string; key: string; state: string; issues: string[] };
      expect(Object.keys(stored).sort()).toEqual(["id", "issues", "key", "state", "updatedAt"]);
      expect(stored.key).toBe(probeKeyFromId(failure.id));
      expect(stored.state).toBe("suppression réussie");
      expect(stored.issues).toEqual(["dépôt"]);
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(JSON.stringify(stored)).not.toContain("fluxora-storage-probe");
      expect(failed.deleted).toHaveLength(2);
      expect(failed.deleted.every((key) => key === probeKeyFromId(key.split("/")[3] ?? ""))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("s3 probe recovery", () => {
  const neighbor = "organizations/org-application-test/documents/neighbor/original";
  const id = "abcdef0123456789";

  function journalOf(directory: string) {
    return createFileProbeJournal(directory);
  }

  function advance(journal: ProbeJournal, state: ProbeState) {
    journal.record({ id, key: probeKeyFromId(id), state, issues: [] });
  }

  it("refuses a truncated, incoherent, altered or missing journal before creating a client", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-recover-"));
    const connect = vi.fn();
    try {
      expect(beginProbeRecovery(allowed(), "pas-un-id", directory, connect).ok).toBe(false);
      expect(beginProbeRecovery(allowed(), "../abcdef0123456789", directory, connect).ok).toBe(false);
      const missing = beginProbeRecovery(allowed(), id, directory, connect);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.reason).toBe("Journal absent.");

      advance(journalOf(directory), "non démarré");
      const blocked = beginProbeRecovery(allowed({ S3_LIVE_CHECK: undefined }), id, directory, connect);
      expect(blocked.ok).toBe(false);
      const idle = beginProbeRecovery(allowed(), id, directory, connect);
      expect(idle.ok).toBe(true);
      if (idle.ok) expect(idle.action).toBe("none");

      await writeFile(path.join(directory, `${id}.json`), "{", "utf8");
      const truncated = readProbeJournal(directory, id);
      expect(truncated.ok).toBe(false);
      if (!truncated.ok) expect(truncated.reason).toBe("Journal tronqué ou illisible.");
      expect(beginProbeRecovery(allowed(), id, directory, connect).ok).toBe(false);

      const key = probeKeyFromId(id);
      await writeFile(path.join(directory, `${id}.json`), JSON.stringify({
        id,
        key,
        state: "terminé",
        updatedAt: "2026-10-12T21:00:00.000Z",
        issues: [],
      }), "utf8");
      const incoherent = readProbeJournal(directory, id);
      expect(incoherent.ok).toBe(false);
      if (!incoherent.ok) expect(incoherent.reason).toBe("Journal incohérent.");

      await writeFile(path.join(directory, `${id}.json`), JSON.stringify({
        id,
        key: neighbor,
        state: "dépôt effectué",
        updatedAt: "2026-10-12T21:00:00.000Z",
        issues: [],
        secret,
      }), "utf8");
      const altered = readProbeJournal(directory, id);
      expect(altered.ok).toBe(false);
      if (!altered.ok) expect(altered.reason).toBe("Journal incohérent.");
      expect(JSON.stringify(altered)).not.toContain(secret);
      expect(JSON.stringify(altered)).not.toContain(neighbor);
      const store = memoryClient();
      store.objects.set(neighbor, Buffer.from("objet-voisin"));
      await expect(recoverStoredProbe(store.client, directory, id)).rejects.toThrow(/Journal/);
      expect(store.deleted).toEqual([]);
      expect(store.objects.has(neighbor)).toBe(true);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers only the interrupted probe key and does not claim an unconfirmed delete", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-recover-"));
    try {
      const journal = journalOf(directory);
      expect(() => journal.record({ id: "../abcdef0123456789", key: neighbor, state: "non démarré", issues: [] })).toThrow(/refusé/);
      advance(journal, "non démarré");
      expect(() => advance(journal, "lecture vérifiée")).toThrow(/refusé/);
      const parent = path.dirname(directory);
      const outside = await readdir(parent);
      expect(outside.some((name) => name.includes("abcdef0123456789"))).toBe(false);
      const kept = readProbeJournal(directory, id);
      expect(kept.ok).toBe(true);
      if (kept.ok) expect(kept.record.state).toBe("non démarré");

      advance(journal, "dépôt potentiellement effectué");
      advance(journal, "dépôt effectué");
      await writeFile(path.join(directory, `${id}.json.${process.pid}.tmp`), JSON.stringify({ key: neighbor, secret, body: "fluxora-storage-probe" }), "utf8");
      const committed = readProbeJournal(directory, id);
      expect(committed.ok).toBe(true);
      if (committed.ok) {
        expect(committed.record.key).toBe(probeKeyFromId(id));
        expect(JSON.stringify(committed.record)).not.toContain(secret);
        expect(JSON.stringify(committed.record)).not.toContain("fluxora-storage-probe");
      }
      if (process.platform !== "win32") {
        expect(statSync(path.join(directory, `${id}.json`)).mode & 0o777).toBe(0o600);
        expect(statSync(directory).mode & 0o777).toBe(0o700);
      }

      const store = memoryClient();
      store.objects.set(neighbor, Buffer.from("objet-voisin"));
      store.objects.set(probeKeyFromId(id), Buffer.from("fluxora-storage-probe"));
      const remove = store.client.delete.bind(store.client);
      store.client.delete = async (key) => {
        store.deleted.push(key);
        throw new Error(`delete ${secret}`);
      };
      const denied = await recoverStoredProbe(store.client, directory, id);
      expect(denied.confirmed).toBe(false);
      expect(denied.residual).toBe(true);
      expect(denied.state).toBe("suppression échouée");
      expect(denied.reason).toMatch(/peut rester/);
      expect(denied.reason).not.toContain("accepté");
      expect(denied.reason).not.toContain(secret);
      expect(JSON.stringify(denied)).not.toContain(secret);
      expect(store.objects.has(neighbor)).toBe(true);
      expect(store.objects.has(probeKeyFromId(id))).toBe(true);
      const persisted = readProbeJournal(directory, id);
      expect(persisted.ok).toBe(true);
      if (persisted.ok) expect(persisted.record.issues).toContain("suppression");

      store.client.delete = remove;
      const recovered = await recoverStoredProbe(store.client, directory, id);
      expect(recovered.network).toBe(true);
      expect(recovered.confirmed).toBe(true);
      expect(recovered.state).toBe("suppression réussie");
      expect(recovered.reason).toContain("ne prouve pas");
      expect(store.deleted).toEqual([probeKeyFromId(id), probeKeyFromId(id)]);
      expect(store.objects.has(neighbor)).toBe(true);
      expect(store.objects.has(probeKeyFromId(id))).toBe(false);

      const finished = journalOf(directory);
      const doneId = "0123456789abcdef";
      for (const state of ["non démarré", "dépôt potentiellement effectué", "dépôt effectué", "lecture vérifiée", "suppression réussie"] as const) {
        finished.record({ id: doneId, key: probeKeyFromId(doneId), state, issues: [] });
      }
      const connect = vi.fn();
      const skipped = beginProbeRecovery(allowed(), doneId, directory, connect);
      expect(skipped.ok).toBe(true);
      if (skipped.ok) expect(skipped.action).toBe("none");
      const untouched = await recoverStoredProbe(store.client, directory, doneId);
      expect(untouched.network).toBe(false);
      expect(untouched.confirmed).toBe(false);
      expect(untouched.reason).toContain("n'appelle pas le fournisseur");
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("s3 probe recovery regressions", () => {
  const neighbor = "organizations/org-application-test/documents/neighbor/original";
  const id = "abcdef0123456789";

  async function prepared(directory: string) {
    const journal = createFileProbeJournal(directory);
    for (const state of ["non démarré", "dépôt potentiellement effectué", "dépôt effectué"] as const) {
      journal.record({ id, key: probeKeyFromId(id), state, issues: [] });
    }
    return journal;
  }

  it("retries the same key after a sanitized delete failure and leaves the neighbor", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-retry-"));
    try {
      await prepared(directory);
      const store = memoryClient();
      store.objects.set(neighbor, Buffer.from("objet-voisin"));
      store.objects.set(probeKeyFromId(id), Buffer.from("reste"));
      store.client.delete = async (key) => {
        expect(key).toBe(probeKeyFromId(id));
        throw new StorageError(`delete ${secret} Authorization`, "unavailable");
      };
      const failed = await recoverStoredProbe(store.client, directory, id);
      expect(failed.confirmed).toBe(false);
      expect(failed.journalUpdated).toBe(true);
      expect(failed.state).toBe("suppression échouée");
      expect(failed.reason).toBe("Suppression échouée (unavailable). Un objet de probe peut rester.");
      expect(JSON.stringify(failed)).not.toContain(secret);
      expect(JSON.stringify(failed)).not.toContain("Authorization");
      expect(store.objects.has(neighbor)).toBe(true);
      expect(store.objects.has(probeKeyFromId(id))).toBe(true);

      store.client.delete = async (key) => {
        expect(key).toBe(probeKeyFromId(id));
        store.deleted.push(key);
        store.objects.delete(key);
      };
      const retried = await recoverStoredProbe(store.client, directory, id);
      expect(retried.confirmed).toBe(true);
      expect(retried.journalUpdated).toBe(true);
      expect(retried.state).toBe("suppression réussie");
      expect(store.deleted).toEqual([probeKeyFromId(id)]);
      expect(store.objects.has(neighbor)).toBe(true);
      const connect = vi.fn();
      const replay = beginProbeRecovery(allowed(), id, directory, connect);
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.action).toBe("none");
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not record a successful delete when the journal is replaced during the call", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-replace-"));
    try {
      await prepared(directory);
      const store = memoryClient();
      store.objects.set(neighbor, Buffer.from("objet-voisin"));
      store.objects.set(probeKeyFromId(id), Buffer.from("reste"));
      const remove = store.client.delete.bind(store.client);
      store.client.delete = async (key) => {
        writeFileSync(path.join(directory, `${id}.json`), `{secret:${secret}`);
        await remove(key);
      };
      const result = await recoverStoredProbe(store.client, directory, id);
      expect(result.confirmed).toBe(true);
      expect(result.journalUpdated).toBe(false);
      expect(result.state).toBe("dépôt effectué");
      expect(result.reason).toContain("accepté");
      expect(result.reason).toContain("journal n'a pas été mis à jour");
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(readProbeJournal(directory, id).ok).toBe(false);
      expect(store.deleted).toEqual([probeKeyFromId(id)]);
      expect(store.objects.has(neighbor)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked journal path and a symlinked temporary file before any delete", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-link-"));
    const connect = vi.fn();
    try {
      await prepared(directory);
      const linked = path.join(tmpdir(), `fluxora-probe-link-dir-${id}`);
      symlinkSync(directory, linked, process.platform === "win32" ? "junction" : "dir");
      const throughLink = beginProbeRecovery(allowed(), id, linked, connect);
      expect(throughLink.ok).toBe(false);
      if (!throughLink.ok) expect(throughLink.reason).toBe("Journal incohérent.");
      expect(connect).not.toHaveBeenCalled();

      const file = path.join(directory, `${id}.json`);
      const alias = path.join(directory, `${id}.alias`);
      const planted = path.join(directory, "plante");
      writeFileSync(alias, readFileSync(file));
      mkdirSync(planted);
      writeFileSync(path.join(planted, "marque.txt"), "objet-voisin");
      unlinkSync(file);
      symlinkSync(planted, file, process.platform === "win32" ? "junction" : "dir");
      expect(readProbeJournal(directory, id).ok).toBe(false);
      unlinkSync(file);
      expect(readFileSync(path.join(planted, "marque.txt"), "utf8")).toBe("objet-voisin");
      writeFileSync(file, readFileSync(alias));
      symlinkSync(planted, `${file}.${process.pid}.tmp`, process.platform === "win32" ? "junction" : "dir");
      expect(() => createFileProbeJournal(directory).record({ id, key: probeKeyFromId(id), state: "lecture vérifiée", issues: [] })).toThrow(/refusé/);
      expect(readFileSync(path.join(planted, "marque.txt"), "utf8")).toBe("objet-voisin");
      const kept = readProbeJournal(directory, id);
      expect(kept.ok).toBe(true);
      if (kept.ok) expect(kept.record.state).toBe("dépôt effectué");
      expect(connect).not.toHaveBeenCalled();
    } finally {
      try {
        unlinkSync(path.join(tmpdir(), `fluxora-probe-link-dir-${id}`));
      } catch {
        // Le lien n'a pas été créé.
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts a probe result only when the reread journal has the same state and key", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-confirm-"));
    try {
      const journal = createFileProbeJournal(directory);
      const store = memoryClient();
      const report = await runStorageProbe(store.client, { journal });
      expect(report.residual).toBe(false);
      expect(journalConfirmsProbe(directory, report)).toBe(true);
      await writeFile(path.join(directory, `${report.id}.json`), "{", "utf8");
      expect(journalConfirmsProbe(directory, report)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the provider result when the final journal write throws a secret", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxora-probe-note-"));
    try {
      const file = createFileProbeJournal(directory);
      const throwing: ProbeJournal = {
        record(trace) {
          if (trace.state === "suppression réussie" || trace.state === "suppression échouée") throw new Error(`journal ${secret}`);
          file.record(trace);
        },
      };
      const store = memoryClient();
      const report = await runStorageProbe(store.client, { journal: throwing }).catch((error: unknown) => error);
      expect(report).toBeInstanceOf(ProbeFailure);
      if (!(report instanceof ProbeFailure)) throw new Error("échec attendu");
      expect(report.message).toBe("Journal de probe refusé.");
      expect(report.residual).toBe(false);
      expect(report.key).toBe(probeKeyFromId(report.id));
      expect(JSON.stringify(report)).not.toContain(secret);
      const stored = readProbeJournal(directory, report.id);
      expect(stored.ok).toBe(true);
      if (stored.ok) expect(stored.record.state).toBe("lecture vérifiée");
      expect(store.deleted).toEqual([report.key]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("restore isolation", () => {
  it("reads the database name and refuses the active database", () => {
    expect(databaseName("postgresql://user:secret@localhost:5432/fluxora?schema=public")).toBe("fluxora");
    expect(() => assertIsolatedRestore("fluxora", "fluxora")).toThrow(/base active/);
    expect(() => assertIsolatedRestore("fluxora", "postgres")).toThrow(/base active/);
    expect(() => assertIsolatedRestore("fluxora", "fluxora_restore")).not.toThrow();
    expect(JSON.stringify(backupFailurePayload("dump"))).not.toContain("secret");
    expect(JSON.stringify(backupFailurePayload("dump"))).toBe('{"alert":"backup_failed","step":"dump"}');
  });
});

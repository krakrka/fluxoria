import { createHash, randomBytes } from "crypto";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeSync } from "fs";
import path from "path";
import { assertTenantStorageKey, StorageError } from "@/lib/storage-error";
import { createS3Client, type S3Target } from "@/services/s3";

export const PROBE_STATES = ["non démarré", "dépôt potentiellement effectué", "dépôt effectué", "lecture vérifiée", "suppression réussie", "suppression échouée"] as const;
export type ProbeState = (typeof PROBE_STATES)[number];
export const PROBE_ISSUES = ["dépôt", "lecture", "suppression"] as const;
export type ProbeIssue = (typeof PROBE_ISSUES)[number];

export type ObjectStore = {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
};

export type ProbeEnv = {
  NODE_ENV?: string;
  S3_BUCKET?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_LIVE_CHECK?: string;
  S3_LIVE_CONFIRM?: string;
  S3_LIVE_BUCKET?: string;
  S3_LIVE_REGION?: string;
  S3_LIVE_ENDPOINT?: string;
  S3_LIVE_ACCESS_KEY_ID?: string;
  S3_LIVE_SECRET_ACCESS_KEY?: string;
};

export type ProbeTrace = {
  id: string;
  key: string;
  state: ProbeState;
  issues: ProbeIssue[];
};

export type ProbeJournalRecord = ProbeTrace & { updatedAt: string };

export type ProbeJournal = {
  record(trace: ProbeTrace): void;
};

export type ProbeReport = ProbeTrace & {
  sha256: string;
  provider: ["put", "get", "get-absent", "delete"];
  local: ["foreign-key"];
  simulated: ["provider-unavailable"];
  notRun: ["prefix-delete", "list", "production-bucket"];
  deleted: boolean;
  residual: boolean;
  deleteError: string | null;
};

export type ProbeRecovery = {
  id: string;
  key: string;
  state: ProbeState;
  issues: ProbeIssue[];
  network: boolean;
  confirmed: boolean;
  residual: boolean;
  deleteError: string | null;
  journalUpdated: boolean;
  reason: string;
};

export class ProbeFailure extends Error {
  readonly id: string;
  readonly key: string;
  readonly state: ProbeState;
  readonly issues: ProbeIssue[];
  readonly residual: boolean;
  readonly deleteError: string | null;

  constructor(message: string, details: ProbeTrace & { residual: boolean; deleteError: string | null }) {
    super(message);
    this.name = "ProbeFailure";
    this.id = details.id;
    this.key = details.key;
    this.state = details.state;
    this.issues = details.issues;
    this.residual = details.residual;
    this.deleteError = details.deleteError;
  }
}

function blank(value: string | undefined) {
  return !value?.trim();
}

export function openProbeClient(
  env: ProbeEnv,
  connect: (target: S3Target) => ObjectStore,
): { ok: false; reason: string } | { ok: true; client: ObjectStore } {
  const decision = evaluateProbeConfig(env);
  if (!decision.ok) return decision;
  return { ok: true, client: connect(decision.target) };
}

const SAFE_MESSAGES = new Set([
  "Intégrité du probe refusée.",
  "Un objet absent a été lu.",
  "La clé étrangère aurait été acceptée.",
  "Le message d'erreur contient un secret.",
  "La panne fournisseur n'a pas été signalée.",
  "Fichier introuvable.",
  "Clé de stockage invalide.",
  "Stockage indisponible.",
  "Journal de probe refusé.",
  "Identifiant de probe invalide.",
]);

function publicFailure(error: unknown) {
  if (error instanceof StorageError) {
    if (error.code === "not_found") return "Fichier introuvable.";
    if (error.code === "invalid_key") return "Clé de stockage invalide.";
    return "Stockage indisponible.";
  }
  if (error instanceof Error && SAFE_MESSAGES.has(error.message)) return error.message;
  return "Stockage indisponible.";
}

export function evaluateProbeConfig(env: ProbeEnv): { ok: true; target: S3Target } | { ok: false; reason: string } {
  if (env.NODE_ENV === "production") return { ok: false, reason: "NODE_ENV=production. Le probe ne part pas." };
  if (env.S3_LIVE_CHECK !== "true") return { ok: false, reason: "S3_LIVE_CHECK n'est pas true. Le probe ne part pas." };
  if (env.S3_LIVE_CONFIRM !== "isolated") return { ok: false, reason: "S3_LIVE_CONFIRM n'est pas isolated. Le probe ne part pas." };
  const bucket = env.S3_LIVE_BUCKET?.trim() ?? "";
  const region = env.S3_LIVE_REGION?.trim() ?? "";
  const accessKeyId = env.S3_LIVE_ACCESS_KEY_ID?.trim() ?? "";
  const secret = env.S3_LIVE_SECRET_ACCESS_KEY ?? "";
  if (blank(bucket) || blank(region) || blank(accessKeyId) || blank(secret)) {
    return { ok: false, reason: "Configuration de probe incomplète. Le probe ne part pas." };
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..")) {
    return { ok: false, reason: "S3_LIVE_BUCKET est invalide. Le probe ne part pas." };
  }
  if (!/^[a-z0-9-]{2,32}$/.test(region) || region.startsWith("-") || region.endsWith("-")) {
    return { ok: false, reason: "S3_LIVE_REGION est invalide. Le probe ne part pas." };
  }
  const appBucket = env.S3_BUCKET?.trim().toLowerCase() ?? "";
  if (!appBucket) return { ok: false, reason: "S3_BUCKET est absent. La comparaison avec le bucket du probe est impossible. Le probe ne part pas." };
  if (appBucket === bucket.toLowerCase()) {
    return { ok: false, reason: "S3_LIVE_BUCKET est identique à S3_BUCKET. Le probe ne part pas." };
  }
  const appKey = env.S3_ACCESS_KEY_ID?.trim() ?? "";
  const appSecret = env.S3_SECRET_ACCESS_KEY ?? "";
  if (blank(appKey) || blank(appSecret)) {
    return { ok: false, reason: "Les identifiants applicatifs sont absents. La comparaison est impossible. Le probe ne part pas." };
  }
  if (appKey === accessKeyId || appSecret === secret) {
    return { ok: false, reason: "Les identifiants du probe sont ceux de l'application. Le probe ne part pas." };
  }
  const endpoint = endpointDecision(env.S3_LIVE_ENDPOINT, env.S3_ENDPOINT, appBucket);
  if (!endpoint.ok) return endpoint;
  return {
    ok: true,
    target: { bucket, region, endpoint: endpoint.endpoint, accessKeyId, secretAccessKey: secret },
  };
}

function endpointDecision(liveValue: string | undefined, appValue: string | undefined, appBucket: string): { ok: true; endpoint?: string } | { ok: false; reason: string } {
  const live = liveValue?.trim() ?? "";
  const app = appValue?.trim() ?? "";
  if (app && !live) return { ok: false, reason: "S3_ENDPOINT est défini et S3_LIVE_ENDPOINT est absent. Le probe ne part pas." };
  if (!live) return { ok: true };
  let url: URL;
  try {
    url = new URL(live);
  } catch {
    return { ok: false, reason: "S3_LIVE_ENDPOINT est incohérent. Le probe ne part pas." };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return { ok: false, reason: "S3_LIVE_ENDPOINT est incohérent. Le probe ne part pas." };
  }
  const hostBucket = url.hostname.split(".")[0]?.toLowerCase() ?? "";
  const pathBucket = url.pathname.split("/").some((part) => {
    try {
      return decodeURIComponent(part).toLowerCase() === appBucket;
    } catch {
      return part.toLowerCase() === appBucket;
    }
  });
  if (hostBucket === appBucket || pathBucket) {
    return { ok: false, reason: "S3_LIVE_ENDPOINT vise le bucket applicatif. Deux noms de bucket ne suffisent pas. Le probe ne part pas." };
  }
  if (app) {
    let appUrl: URL;
    try {
      appUrl = new URL(app);
    } catch {
      return { ok: false, reason: "S3_ENDPOINT est incohérent. Le probe ne part pas." };
    }
    if (appUrl.origin === url.origin) {
      return { ok: false, reason: "S3_LIVE_ENDPOINT a la même origine que S3_ENDPOINT. Deux noms de bucket ne suffisent pas. Le probe ne part pas." };
    }
  }
  return { ok: true, endpoint: live };
}

export function probeKeyFromId(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("Identifiant de probe invalide.");
  return `organizations/s3-live-check/probes/${id}/probe.txt`;
}

const NEXT_STATE: Record<"start" | ProbeState, readonly ProbeState[]> = {
  start: ["non démarré"],
  "non démarré": ["non démarré", "dépôt potentiellement effectué"],
  "dépôt potentiellement effectué": ["dépôt potentiellement effectué", "dépôt effectué", "suppression réussie", "suppression échouée"],
  "dépôt effectué": ["dépôt effectué", "lecture vérifiée", "suppression réussie", "suppression échouée"],
  "lecture vérifiée": ["lecture vérifiée", "suppression réussie", "suppression échouée"],
  "suppression échouée": ["suppression échouée", "suppression réussie"],
  "suppression réussie": ["suppression réussie"],
};

function isProbeState(value: unknown): value is ProbeState {
  return typeof value === "string" && (PROBE_STATES as readonly string[]).includes(value);
}

function isProbeIssue(value: unknown): value is ProbeIssue {
  return value === "dépôt" || value === "lecture" || value === "suppression";
}

function canonicalIssues(issues: readonly ProbeIssue[]): ProbeIssue[] {
  return PROBE_ISSUES.filter((issue) => issues.includes(issue));
}

export function probeJournalIsCoherent(record: ProbeJournalRecord) {
  if (!/^[a-f0-9]{16}$/.test(record.id) || record.key !== probeKeyFromId(record.id)) return false;
  if (!isProbeState(record.state)) return false;
  if (!Array.isArray(record.issues) || record.issues.some((issue) => !isProbeIssue(issue))) return false;
  const issues = canonicalIssues(record.issues);
  if (issues.length !== record.issues.length || issues.some((issue, index) => issue !== record.issues[index])) return false;
  if (record.issues.includes("dépôt") && record.issues.includes("lecture")) return false;
  if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString() !== record.updatedAt) return false;
  const has = (issue: ProbeIssue) => record.issues.includes(issue);
  if (record.state === "non démarré" || record.state === "lecture vérifiée") return record.issues.length === 0;
  if (record.state === "dépôt potentiellement effectué") return record.issues.length === 0 || (record.issues.length === 1 && record.issues[0] === "dépôt");
  if (record.state === "dépôt effectué") return record.issues.length === 0 || (record.issues.length === 1 && record.issues[0] === "lecture");
  if (record.state === "suppression réussie") return !has("suppression");
  return has("suppression");
}

function journalFile(directory: string, id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const root = path.resolve(directory);
  const file = path.resolve(root, `${id}.json`);
  if (path.dirname(file) !== root) return null;
  return file;
}

function errno(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

function refuseLink(file: string) {
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error("Journal de probe refusé.");
  } catch (error) {
    if (error instanceof Error && error.message === "Journal de probe refusé.") throw error;
    if (errno(error) === "ENOENT") return;
    throw new Error("Journal de probe refusé.");
  }
}

function bestEffortChmod(file: string, mode: number) {
  try {
    chmodSync(file, mode);
  } catch {
    // Windows peut ignorer ces modes. Le compte du processus reste la limite.
  }
}

function fsyncDirectory(directory: string) {
  let fd: number | null = null;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch {
    // La synchronisation du dossier n'est pas garantie, notamment sous Windows.
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function writeAtomic(directory: string, file: string, body: string) {
  refuseLink(file);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    const existing = lstatSync(temporary);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Journal de probe refusé.");
    unlinkSync(temporary);
  } catch (error) {
    if (error instanceof Error && error.message === "Journal de probe refusé.") throw error;
    if (errno(error) !== "ENOENT") throw new Error("Journal de probe refusé.");
  }
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, body, undefined, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  bestEffortChmod(temporary, 0o600);
  try {
    renameSync(temporary, file);
  } catch {
    try {
      unlinkSync(temporary);
    } catch {
      // Le fichier temporaire orphelin n'est pas lu.
    }
    throw new Error("Journal de probe refusé.");
  }
  bestEffortChmod(file, 0o600);
  fsyncDirectory(directory);
}

export function createProbeIdentity() {
  const id = randomBytes(8).toString("hex");
  return { id, key: probeKeyFromId(id) };
}

function readJournalText(file: string): { ok: true; raw: string } | { ok: false; reason: string } {
  const noFollow = "O_NOFOLLOW" in constants ? Number(constants["O_NOFOLLOW" as keyof typeof constants]) : 0;
  let fd: number;
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024) return { ok: false, reason: "Journal incohérent." };
    fd = openSync(file, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (errno(error) === "ENOENT") return { ok: false, reason: "Journal absent." };
    if (errno(error) === "ELOOP" || errno(error) === "EPERM") return { ok: false, reason: "Journal incohérent." };
    return { ok: false, reason: "Journal illisible." };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024) return { ok: false, reason: "Journal incohérent." };
    const body = Buffer.alloc(stat.size);
    readSync(fd, body, 0, stat.size, 0);
    return { ok: true, raw: body.toString("utf8") };
  } catch {
    return { ok: false, reason: "Journal illisible." };
  } finally {
    closeSync(fd);
  }
}

export function readProbeJournal(directory: string, id: string): { ok: true; record: ProbeJournalRecord } | { ok: false; reason: string } {
  const file = journalFile(directory, id);
  if (!file) return { ok: false, reason: "Identifiant de probe invalide." };
  try {
    const root = lstatSync(path.resolve(directory));
    if (root.isSymbolicLink()) return { ok: false, reason: "Journal incohérent." };
    if (!root.isDirectory()) return { ok: false, reason: "Journal illisible." };
  } catch (error) {
    if (errno(error) === "ENOENT") return { ok: false, reason: "Journal absent." };
    return { ok: false, reason: "Journal illisible." };
  }
  const text = readJournalText(file);
  if (!text.ok) return text;
  const raw = text.raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Journal tronqué ou illisible." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "Journal incohérent." };
  const body = parsed as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "id,issues,key,state,updatedAt") return { ok: false, reason: "Journal incohérent." };
  if (body.id !== id || typeof body.key !== "string" || typeof body.updatedAt !== "string" || !isProbeState(body.state) || !Array.isArray(body.issues)) {
    return { ok: false, reason: "Journal incohérent." };
  }
  const record: ProbeJournalRecord = { id, key: body.key, state: body.state, updatedAt: body.updatedAt, issues: body.issues.filter(isProbeIssue) };
  if (record.issues.length !== body.issues.length || !probeJournalIsCoherent(record)) return { ok: false, reason: "Journal incohérent." };
  return { ok: true, record };
}

export function createFileProbeJournal(directory: string): ProbeJournal {
  return {
    record(trace) {
      const file = journalFile(directory, trace.id);
      const key = /^[a-f0-9]{16}$/.test(trace.id) ? probeKeyFromId(trace.id) : "";
      if (!file || trace.key !== key) throw new Error("Journal de probe refusé.");
      const current = readProbeJournal(directory, trace.id);
      const previous = current.ok ? current.record.state : current.reason === "Journal absent." ? null : undefined;
      if (previous === undefined) throw new Error("Journal de probe refusé.");
      if (!NEXT_STATE[previous ?? "start"].includes(trace.state)) throw new Error("Journal de probe refusé.");
      const record: ProbeJournalRecord = { ...trace, issues: canonicalIssues(trace.issues), updatedAt: new Date().toISOString() };
      if (!probeJournalIsCoherent(record)) throw new Error("Journal de probe refusé.");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const root = lstatSync(directory);
      if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("Journal de probe refusé.");
      bestEffortChmod(directory, 0o700);
      writeAtomic(directory, file, JSON.stringify({ id: record.id, key: record.key, state: record.state, updatedAt: record.updatedAt, issues: record.issues }));
    },
  };
}

export function journalConfirmsProbe(directory: string, report: { id: string; key: string; state: ProbeState }) {
  const recorded = readProbeJournal(directory, report.id);
  return recorded.ok && recorded.record.state === report.state && recorded.record.key === report.key;
}

export function planProbeRecovery(record: ProbeJournalRecord): { action: "delete"; key: string } | { action: "none"; reason: string } {
  if (!probeJournalIsCoherent(record) || record.key !== probeKeyFromId(record.id)) {
    return { action: "none", reason: "Journal incohérent." };
  }
  if (record.state === "non démarré") return { action: "none", reason: "Aucun dépôt confirmé. Aucune suppression." };
  if (record.state === "suppression réussie") {
    return { action: "none", reason: "Le journal indique une suppression déjà acceptée. Cette reprise n'appelle pas le fournisseur et ne confirme pas une nouvelle suppression." };
  }
  return { action: "delete", key: probeKeyFromId(record.id) };
}

export function beginProbeRecovery(
  env: ProbeEnv,
  id: string,
  directory: string,
  connect: (target: S3Target) => ObjectStore,
): { ok: false; reason: string } | { ok: true; action: "none"; reason: string; record: ProbeJournalRecord } | { ok: true; action: "delete"; client: ObjectStore; record: ProbeJournalRecord } {
  if (!/^[a-f0-9]{16}$/.test(id)) return { ok: false, reason: "Identifiant de probe invalide." };
  const decision = evaluateProbeConfig(env);
  if (!decision.ok) return decision;
  const loaded = readProbeJournal(directory, id);
  if (!loaded.ok) return loaded;
  const plan = planProbeRecovery(loaded.record);
  if (plan.action === "none") return { ok: true, action: "none", reason: plan.reason, record: loaded.record };
  return { ok: true, action: "delete", client: connect(decision.target), record: loaded.record };
}

function ownProbeKey(key: string, id: string) {
  try {
    return key === probeKeyFromId(id);
  } catch {
    return false;
  }
}

function safeProviderError(error: unknown) {
  if (error instanceof ProbeFailure) return error;
  return new StorageError(publicFailure(error), error instanceof StorageError ? error.code : "unavailable");
}

function safeDeleteError(error: unknown) {
  if (error instanceof StorageError && (error.code === "invalid_key" || error.code === "not_found" || error.code === "unavailable")) {
    return `Suppression échouée (${error.code}). Un objet de probe peut rester.`;
  }
  return "Suppression échouée. Un objet de probe peut rester.";
}

async function deleteOwn(client: ObjectStore, id: string, key: string) {
  if (!ownProbeKey(key, id)) {
    return { deleted: false, residual: true, deleteError: "Suppression refusée : la clé n'est pas celle de cette exécution. Un objet peut rester." };
  }
  try {
    await client.delete(key);
    return { deleted: true, residual: false, deleteError: null };
  } catch (error) {
    return { deleted: false, residual: true, deleteError: safeDeleteError(error) };
  }
}

async function assertMissing(client: ObjectStore, key: string) {
  try {
    await client.get(key);
  } catch (error) {
    const safe = safeProviderError(error);
    if (safe instanceof StorageError && safe.code === "not_found") return;
    throw safe;
  }
  throw new Error("Un objet absent a été lu.");
}

async function assertProviderUnavailable() {
  const marker = "probe-dummy-secret";
  const failing = createS3Client(
    {
      bucket: "probe-bucket",
      region: "eu-west-3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: marker,
    },
    async () => {
      throw new Error(`down ${marker}`);
    },
  );
  try {
    await failing.get("organizations/s3-live-check/probes/unavailable/probe.txt");
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== "unavailable") throw error;
    if (error.message.includes(marker)) throw new Error("Le message d'erreur contient un secret.");
    return;
  }
  throw new Error("La panne fournisseur n'a pas été signalée.");
}

function expectForeignKeyRefused(key: string) {
  try {
    assertTenantStorageKey(key, "autre-organisation");
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") return;
    throw error;
  }
  throw new Error("La clé étrangère aurait été acceptée.");
}

function notedIssues(issues: readonly ProbeIssue[], residual: boolean): ProbeIssue[] {
  return canonicalIssues(residual ? [...issues, "suppression"] : issues.filter((issue) => issue !== "suppression"));
}

export async function runStorageProbe(client: ObjectStore, options?: { identity?: { id: string; key: string }; journal?: ProbeJournal }): Promise<ProbeReport> {
  const generated = options?.identity ?? createProbeIdentity();
  if (!/^[a-f0-9]{16}$/.test(generated.id)) throw new Error("Identifiant de probe invalide.");
  const id = generated.id;
  const key = probeKeyFromId(id);
  if (generated.key !== key) {
    throw new ProbeFailure("Identifiant de probe invalide.", { id, key, state: "non démarré", issues: [], residual: false, deleteError: null });
  }
  const absent = `organizations/s3-live-check/probes/${id}/absent.txt`;
  const note = (state: ProbeState, issues: ProbeIssue[]) => options?.journal?.record({ id, key, state, issues });
  note("non démarré", []);
  const body = Buffer.from(`fluxora-storage-probe ${id}\n`);
  const sha256 = createHash("sha256").update(body).digest("hex");
  note("dépôt potentiellement effectué", []);
  let settled = false;
  let pending: ProbeIssue[] = [];
  try {
    try {
      await client.put(key, body);
    } catch (error) {
      pending = ["dépôt"];
      throw safeProviderError(error);
    }
    note("dépôt effectué", []);
    let read: Buffer;
    try {
      read = await client.get(key);
    } catch (error) {
      pending = ["lecture"];
      throw safeProviderError(error);
    }
    if (!read.equals(body) || createHash("sha256").update(read).digest("hex") !== sha256) {
      pending = ["lecture"];
      throw new Error("Intégrité du probe refusée.");
    }
    note("lecture vérifiée", []);
    await assertMissing(client, absent);
    expectForeignKeyRefused(key);
    await assertProviderUnavailable();
    const removed = await deleteOwn(client, id, key);
    settled = true;
    const state: ProbeState = removed.residual ? "suppression échouée" : "suppression réussie";
    const issues = notedIssues([], removed.residual);
    try {
      note(state, issues);
    } catch {
      throw new ProbeFailure("Journal de probe refusé.", { id, key, state, issues, residual: removed.residual, deleteError: removed.deleteError });
    }
    return {
      id,
      key,
      state,
      issues,
      sha256,
      provider: ["put", "get", "get-absent", "delete"],
      local: ["foreign-key"],
      simulated: ["provider-unavailable"],
      notRun: ["prefix-delete", "list", "production-bucket"],
      ...removed,
    };
  } catch (error) {
    if (settled) throw error;
    if (pending.includes("lecture")) {
      try {
        note("dépôt effectué", ["lecture"]);
      } catch {
        // Le dernier état cohérent reste la base de reprise.
      }
    } else if (pending.includes("dépôt")) {
      try {
        note("dépôt potentiellement effectué", ["dépôt"]);
      } catch {
        // Le dernier état cohérent reste la base de reprise.
      }
    }
    const removed = await deleteOwn(client, id, key);
    const state: ProbeState = removed.residual ? "suppression échouée" : "suppression réussie";
    const issues = notedIssues(pending, removed.residual);
    try {
      note(state, issues);
    } catch {
      // Le résultat fournisseur reste porté par l'erreur renvoyée.
    }
    throw new ProbeFailure(publicFailure(error), { id, key, state, issues, residual: removed.residual, deleteError: removed.deleteError });
  }
}

export async function recoverStoredProbe(client: ObjectStore, directory: string, id: string): Promise<ProbeRecovery> {
  const loaded = readProbeJournal(directory, id);
  if (!loaded.ok) throw new Error(loaded.reason);
  const plan = planProbeRecovery(loaded.record);
  if (plan.action === "none") {
    return {
      id: loaded.record.id,
      key: loaded.record.key,
      state: loaded.record.state,
      issues: loaded.record.issues,
      network: false,
      confirmed: false,
      residual: loaded.record.state === "suppression échouée",
      deleteError: null,
      journalUpdated: true,
      reason: plan.reason,
    };
  }
  const removed = await deleteOwn(client, id, plan.key);
  const state: ProbeState = removed.residual ? "suppression échouée" : "suppression réussie";
  const issues = notedIssues(loaded.record.issues, removed.residual);
  let journalUpdated = false;
  try {
    createFileProbeJournal(directory).record({ id, key: plan.key, state, issues });
    const checked = readProbeJournal(directory, id);
    journalUpdated = checked.ok && checked.record.state === state && checked.record.key === plan.key && checked.record.id === id;
  } catch {
    journalUpdated = false;
  }
  const accepted = "Le fournisseur a accepté la suppression de cette clé. Cela ne prouve pas qu'un objet était présent.";
  return {
    id,
    key: plan.key,
    state: journalUpdated ? state : loaded.record.state,
    issues: journalUpdated ? issues : loaded.record.issues,
    network: true,
    confirmed: removed.deleted,
    residual: removed.residual,
    deleteError: removed.deleteError,
    journalUpdated,
    reason: removed.deleted
      ? journalUpdated
        ? accepted
        : `${accepted} Le journal n'a pas été mis à jour.`
      : (removed.deleteError ?? "Suppression non confirmée. Un objet peut rester."),
  };
}

function issueLines(issues: readonly ProbeIssue[]) {
  return issues.map((issue) => {
    if (issue === "dépôt") return "Échec de dépôt enregistré. Un objet a pu être créé.";
    if (issue === "lecture") return "Échec de lecture enregistré.";
    return "Échec de suppression enregistré. Un objet peut rester.";
  });
}

export function formatProbeReport(report: ProbeReport) {
  const deletion = report.residual
    ? (report.deleteError ?? "Suppression non confirmée. Un objet peut rester.")
    : "Le fournisseur a accepté la suppression de cette clé. Cela ne prouve pas qu'un objet était présent.";
  return [
    "Fournisseur : put, get, get de l'objet absent, delete de la clé créée.",
    "Local, sans appel réseau : refus d'une clé d'une autre organisation.",
    "Simulé, client factice : panne fournisseur. Ce n'est pas une preuve du fournisseur réel.",
    "Non exécuté : listage, suppression de préfixe, contrôle du bucket de production.",
    `État : ${report.state}`,
    `Identifiant : ${report.id}`,
    deletion,
    ...issueLines(report.issues),
    `Clé : ${report.key}`,
    "La clé se reconstruit depuis l'identifiant : organizations/s3-live-check/probes/{id}/probe.txt.",
    "Aucun dépôt confirmé correspond à l'état non démarré. Dépôt potentiellement effectué signifie qu'un objet a pu être créé.",
    `Empreinte ${report.sha256}.`,
    "Le nom du bucket n'a pas servi de preuve. Ce résultat ne rend pas le stockage applicatif opérationnel.",
  ];
}

export function formatProbeFailure(error: ProbeFailure) {
  const situation = error.state === "non démarré"
    ? "Aucun dépôt confirmé. Aucune suppression."
    : error.state === "dépôt potentiellement effectué"
      ? "Dépôt potentiellement effectué. Suppression non confirmée. Un objet peut rester."
      : error.residual
        ? (error.deleteError ?? "Suppression non confirmée. Un objet peut rester.")
        : "Le fournisseur a accepté la suppression de cette clé. Cela ne prouve pas qu'un objet était présent.";
  return [
    error.message,
    `État : ${error.state}`,
    `Identifiant : ${error.id}`,
    `Clé : ${error.key}`,
    situation,
    ...issueLines(error.issues),
    "Aucun préfixe n'a été listé ni supprimé. S3 n'est pas validé.",
  ];
}

export function formatProbeRecovery(result: ProbeRecovery) {
  return [
    `État : ${result.state}`,
    `Identifiant : ${result.id}`,
    `Clé : ${result.key}`,
    result.reason,
    ...issueLines(result.issues),
    "Aucun préfixe n'a été listé ni supprimé. S3 n'est pas validé.",
  ];
}
